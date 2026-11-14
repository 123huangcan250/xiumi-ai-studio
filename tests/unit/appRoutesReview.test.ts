import { createHash } from 'node:crypto'
import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'xiumi-route-review-'))
  process.env.XIUMI_DATA_DIR = process.env.DATA_DIR
  process.env.AI_SELECTION_POLICY = 'filter'
})

// Do not importOriginal here: ai -> aiModels -> ai is a cycle, and a partial
// async mock can expose the real module while that cycle is being evaluated.
// These route tests exercise HTTP wiring, not provider transport or prompt text.
// Every provider entry point is a fail-closed stub, so no test can contact a model.
function createProviderMocks() {
  const unexpectedProviderCall = () => { throw new Error('Unconfigured provider call in route test') }
  return {
    aiStatus: vi.fn(unexpectedProviderCall),
    chatText: vi.fn(unexpectedProviderCall),
    chatJson: vi.fn(unexpectedProviderCall),
    discoverModels: vi.fn(unexpectedProviderCall),
    testConnection: vi.fn(unexpectedProviderCall),
    COPY_SYSTEM: 'test copy prompt', DESIGN_SYSTEM: 'test design prompt',
    EDIT_SYSTEM: 'test edit prompt', ENRICH_SYSTEM: 'test enrich prompt',
    OUTLINE_SYSTEM: 'test outline prompt', PLACE_SYSTEM: 'test place prompt',
  }
}

type AiModule = typeof import('../../server/ai')
type NetModule = typeof import('../../server/net')
let chatJson: AiModule['chatJson']
let discoverModels: AiModule['discoverModels']
let testConnection: AiModule['testConnection']
let safeFetch: NetModule['safeFetch']
let MAX_PAGE_BYTES: NetModule['MAX_PAGE_BYTES']

let server: Server
let base: string
beforeAll(async () => {
  // Reset evaluated modules before registering this fixture's factories. Never
  // retain a static server import across the reset: app and assertions must share
  // the same provider, network and settings boundaries.
  vi.resetModules()
  const provider = createProviderMocks()
  const fetchStub = vi.fn<NetModule['safeFetch']>(() => { throw new Error('Unconfigured network call in route test') })
  const draftStub = vi.fn(async (draft: unknown) => draft)
  let factoryCalls = 0
  vi.doMock('../../server/ai', () => { factoryCalls++; return provider })
  vi.doMock('../../server/net', async importOriginal => ({
    ...await importOriginal<NetModule>(), safeFetch: fetchStub,
  }))
  vi.doMock('../../server/settings', async importOriginal => ({
    ...await importOriginal<typeof import('../../server/settings')>(), resolveDraftProfile: draftStub,
  }))
  const ai = await import('../../server/ai')
  const net = await import('../../server/net')
  const settings = await import('../../server/settings')
  ;({ chatJson, discoverModels, testConnection } = ai)
  ;({ safeFetch, MAX_PAGE_BYTES } = net)
  const verifyBoundaries = () => {
    expect(factoryCalls).toBe(1)
    for (const name of ['chatJson', 'discoverModels', 'testConnection'] as const) {
      expect(vi.isMockFunction(ai[name])).toBe(true)
      expect(ai[name]).toBe(provider[name])
    }
    expect(net.safeFetch).toBe(fetchStub)
    expect(settings.resolveDraftProfile).toBe(draftStub)
  }
  verifyBoundaries()
  const { createApp } = await import('../../server/app')
  verifyBoundaries()
  server = await new Promise<Server>(resolve => {
    const listening = createApp().listen(0, '127.0.0.1', () => resolve(listening))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test address')
  base = `http://127.0.0.1:${address.port}`
})
afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) })
beforeEach(() => { vi.resetAllMocks() })
const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('reviewed routes survive the app/launcher split', () => {
  it('returns model discovery as the array expected by the client', async () => {
    vi.mocked(discoverModels).mockResolvedValue([{ id: 'custom', efforts: ['high'] }])
    const response = await post('/api/settings/ai/models', { model: 'custom' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([{ id: 'custom', efforts: ['high'] }])
    expect(discoverModels).toHaveBeenCalledTimes(1)
  })
  it('uses the reviewed connection helper instead of the old 100-token probe', async () => {
    vi.mocked(testConnection).mockResolvedValue({ ok: true })
    const response = await post('/api/settings/ai/test', { model: 'custom' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, reply: { ok: true } })
    expect(testConnection).toHaveBeenCalledWith({ model: 'custom' })
    expect(chatJson).not.toHaveBeenCalled()
  })
  it('keeps suggestion validation and the suggestion endpoint', async () => {
    const response = await post('/api/ai/suggest-instruction', { selectedId: 42, context: {} })
    expect(response.status).toBe(400)
    expect(chatJson).not.toHaveBeenCalled()
  })
  it('returns a valid suggestion without applying edits', async () => {
    vi.mocked(chatJson).mockResolvedValue({ suggestion: 'Shorten the title' })
    const response = await post('/api/ai/suggest-instruction', { context: { blocks: [] } })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ suggestion: 'Shorten the title' })
  })
  it('bounds image forwarding before buffering', async () => {
    vi.mocked(safeFetch).mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
    const response = await fetch(base + '/api/wx-image?u=' + encodeURIComponent('https://mmbiz.qpic.cn/image'))
    expect(response.status).toBe(200)
    expect(safeFetch).toHaveBeenCalledWith('https://mmbiz.qpic.cn/image', expect.objectContaining({ maxBytes: 30 * 1024 * 1024 }))
  })
  it('filters out-of-scope edits via prepareEdit while preserving valid updates', async () => {
    vi.mocked(chatJson).mockResolvedValue({ ops: [{ op: 'update', id: 'p1', props: { content: 'ok' } }, { op: 'update', id: 'p2', props: { content: 'outside' } }] })
    const response = await post('/api/ai/edit', { selectedId: 'p1', context: { blocks: [{ id: 'p1', type: 'paragraph' }, { id: 'p2', type: 'paragraph' }] }, instruction: 'edit' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ selectionPolicy: 'filter', ignoredOps: 1, ops: [{ op: 'update', id: 'p1' }] })
  })
  it.each(['/api/article/fetch', '/api/reference/fetch'])('keeps complete large content with the byte budget at %s', async path => {
    const html = '<p>' + 'a'.repeat(5_000_010) + '</p>'
    vi.mocked(safeFetch).mockResolvedValue(new Response(html))
    const response = await post(path, { url: 'https://example.com/article' })
    expect(response.status).toBe(200)
    const actual = (await response.json()).html
    expect(actual.length).toBe(html.length)
    expect(createHash('sha256').update(actual).digest('hex')).toBe(createHash('sha256').update(html).digest('hex'))
    expect(safeFetch).toHaveBeenCalledWith('https://example.com/article', expect.objectContaining({ maxBytes: MAX_PAGE_BYTES }))
  })
  it('retains the upstream app information route and local-only boundary', async () => {
    const response = await fetch(base + '/api/app/info')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ packaged: false, canQuit: false })
    const blocked = await fetch(base + '/api/settings/ai/test', { method: 'POST', headers: { origin: 'https://outside.example', 'content-type': 'application/json' }, body: '{}' })
    expect(blocked.status).toBe(403)
    expect(testConnection).not.toHaveBeenCalled()
  })
})

it('cancels the provider request when the suggestion client disconnects', async()=>{
 let ready!:()=>void, aborted!:()=>void
 const started=new Promise<void>(r=>ready=r), cancelled=new Promise<void>(r=>aborted=r)
 vi.mocked(chatJson).mockImplementation(async(_system,_user,opts)=>new Promise((_resolve,reject)=>{
   expect(opts?.signal).toBeDefined()
   opts!.signal!.addEventListener('abort',()=>{aborted();reject(opts!.signal!.reason)},{once:true});ready()
 }))
 const ctrl=new AbortController()
 const pending=fetch(base+'/api/ai/suggest-instruction',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context:{blocks:[]}}),signal:ctrl.signal})
 const result=expect(pending).rejects.toMatchObject({name:'AbortError'})
 await started;ctrl.abort();await result;await cancelled
})

describe('multi-selection request boundaries over actual HTTP',()=>{
 const context={blocks:[{id:'a',type:'paragraph'},{id:'b',type:'paragraph'},{id:'c',type:'paragraph'}]}
 it.each(['/api/ai/edit','/api/ai/suggest-instruction'])('rejects empty, duplicate, missing or conflicting scope before provider at %s',async path=>{
  for(const selectedIds of [[],['a','a'],['missing'],['a',3]]){
   const response=await post(path,{context,selectedIds,instruction:'edit'});expect(response.status).toBe(400)
  }
  const conflict=await post(path,{context:{...context,focus:{ids:['b','c']}},selectedIds:['a','b'],instruction:'edit'});expect(conflict.status).toBe(400)
  expect(chatJson).not.toHaveBeenCalled()
 })
 it('filters multi selected remove/insert and leaves outside edits ignored despite client/model policy spoof',async()=>{
  vi.mocked(chatJson).mockResolvedValue({selectionPolicy:'strict',ignoredOps:90,ops:[{op:'remove',id:'b'},{op:'insert',index:'1',block:{type:'paragraph'}},{op:'update',id:'c'}]})
  const response=await post('/api/ai/edit',{context,selectedId:'b',selectedIds:['a','b'],selectionPolicy:'strict',instruction:'edit'})
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({selectionPolicy:'filter',ignoredOps:1,ops:[{op:'remove',id:'b'},{op:'insert',index:1,anchor:{id:'a',side:'after'}}]})
 })
 it('applies server strict policy atomically for a selected union',async()=>{
  const previous=process.env.AI_SELECTION_POLICY;process.env.AI_SELECTION_POLICY='strict'
  try{
   vi.mocked(chatJson).mockResolvedValue({selectionPolicy:'filter',ops:[{op:'update',id:'a'},{op:'remove',id:'b'}]})
   expect((await post('/api/ai/edit',{context,selectedIds:['a','b'],instruction:'edit',selectionPolicy:'filter'})).status).toBe(502)
  }finally{process.env.AI_SELECTION_POLICY=previous}
 })
 it('suggests within the selected union and retains the old single request',async()=>{
  vi.mocked(chatJson).mockResolvedValue({suggestion:'shorten'})
  expect((await post('/api/ai/suggest-instruction',{context,selectedIds:['a','b']})).status).toBe(200)
  expect(vi.mocked(chatJson).mock.calls[0][1]).toContain('仅修改选中模块 a、b')
  expect((await post('/api/ai/suggest-instruction',{context,selectedId:'a'})).status).toBe(200)
 })
})

describe('confirmed article image collection over actual local HTTP',()=>{
 it('imports only approved remote sources, persists a digest and reuses the real indexed image',async()=>{
  vi.mocked(safeFetch).mockResolvedValue(new Response('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>'))
  const url='https://img.xiumi.us/article?private=fixture'
  const response=await post('/api/assets/import-article',{urls:[url,'http://localhost/private']});expect(response.status).toBe(200)
  const results=await response.json();expect(results.map((r:any)=>r.status)).toEqual(['imported','failed']);expect(results[0].asset.sourceKey).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(results[0].asset)).not.toContain('private=')
  expect(safeFetch).toHaveBeenCalledTimes(1);const opts=vi.mocked(safeFetch).mock.calls[0][1]!;expect(opts.maxBytes).toBe(30*1024*1024);expect(opts.allowHost!('127.0.0.1')).toBe(false)
  const again=await post('/api/assets/import-article',{urls:[url,`/media/${results[0].asset.file}?fit=3:2&w=800`]});expect((await again.json()).map((r:any)=>r.status)).toEqual(['existing','existing']);expect(safeFetch).toHaveBeenCalledTimes(1);expect(chatJson).not.toHaveBeenCalled()
 })
 it('rejects malformed and cross-origin collection without a provider or network call',async()=>{
  expect((await post('/api/assets/import-article',{urls:'wrong'})).status).toBe(400)
  expect((await fetch(base+'/api/assets/import-article',{method:'POST',headers:{origin:'https://outside.example','content-type':'application/json'},body:'{"urls":[]}'})).status).toBe(403)
  expect(safeFetch).not.toHaveBeenCalled();expect(chatJson).not.toHaveBeenCalled()
 })
})
it('recognizes a real managed replay glyph without indexing or re-encoding it',async()=>{
 const sharp=(await import('sharp')).default
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:'#fff'}}).png().toBuffer()
 const data='data:image/png;base64,'+bytes.toString('base64')
 const glyph=await post('/api/replay/glyphs',{images:[data]});expect(glyph.status).toBe(200);const map=await glyph.json()
 const before=await(await fetch(base+'/api/assets')).json()
 const r=await post('/api/assets/import-article',{urls:[map[data]]});expect(await r.json()).toEqual([{url:map[data],status:'existing',kind:'glyph'}])
 expect(await(await fetch(base+'/api/assets')).json()).toEqual(before);expect(safeFetch).not.toHaveBeenCalled();expect(chatJson).not.toHaveBeenCalled()
})
