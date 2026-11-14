// @vitest-environment jsdom
// Component integration: existing App keyboard listener and real selection/history store; leaf UI is isolated.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { createBlock } from '../../src/core/blocks'
import { emptyDoc, useStore } from '../../src/editor/store'
vi.mock('../../src/editor/Canvas', () => ({ Canvas: () => null }))
vi.mock('../../src/editor/LeftPanel', () => ({ LeftPanel: () => null }))
vi.mock('../../src/editor/RightPanel', () => ({ RightPanel: () => null }))
vi.mock('../../src/editor/Toolbar', () => ({ Toolbar: () => null }))
vi.mock('../../src/editor/Workspace', () => ({ Workspace: ({ children }: any) => children }))
vi.mock('../../src/editor/CollectModal', () => ({ CollectHost: () => null }))
vi.mock('../../src/editor/ReplayPreview', () => ({ ReplayHost: () => null }))
let root: Root, host: HTMLDivElement
let writes: any[]
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useStore.getState().load({ ...emptyDoc(), id: 'original-memory', title: 'Do not replace' })
  useStore.setState({ toast: null })
  writes = []; host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); useStore.getState().load(emptyDoc()) })
function transport(body: unknown, failure?: Error) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { const doc = JSON.parse(init.body as string); writes.push(doc); return Response.json({ ...doc, revision: 'r1' }) }
    if (url === '/api/projects') return failure ? { ok: true, status: 200, json: async () => { throw failure } } : Response.json(body)
    if (url === '/api/themes') return Response.json([])
    throw new Error('Unexpected request: ' + url)
  })
}
it('keyboard multi-delete is one undo while typing and dialogs retain their own delete behavior',async()=>{
 transport([]);await act(async()=>root.render(createElement(App)))
 const state=()=>useStore.getState()
 act(()=>{state().load({...emptyDoc(),blocks:['a','b','c'].map(id=>({...createBlock('paragraph'),id}))});state().select('a');state().select('b',{toggle:true})})
 const input=document.createElement('input');host.append(input)
 act(()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true})));expect(state().doc.blocks).toHaveLength(3)
 const dialog=document.createElement('div');dialog.setAttribute('role','dialog');host.append(dialog)
 act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete'})));expect(state().doc.blocks).toHaveLength(3);dialog.remove()
 act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete'})));expect(state().doc.blocks.map(b=>b.id)).toEqual(['c']);expect(state().past).toHaveLength(1)
 act(()=>state().undo());expect(state().doc.blocks.map(b=>b.id)).toEqual(['a','b','c'])
 act(()=>{state().select('b');window.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete'}))});expect(state().selectedId).toBe('c')
})
