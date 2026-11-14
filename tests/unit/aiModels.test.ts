import { afterEach, describe, expect, it, vi } from 'vitest'
import { adjustWire, chatText } from '../../server/ai'
import { fetchModels, parseModels, probeEfforts } from '../../server/aiModels'
import type { AiProfile } from '../../server/settings'

const profile = (over: Partial<AiProfile> = {}): AiProfile => ({ id: 'p', name: 'P', provider: 'openai', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'm1', jsonMode: true, ...over })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => vi.unstubAllGlobals())

describe('upstream model list', () => {
  it('reads ids, context and output limits from the common shapes', () => {
    const list = parseModels({
      data: [
        { id: 'deepseek-chat', object: 'model' },
        { id: 'vendor/big', name: 'Big', context_length: 200000, top_provider: { max_completion_tokens: 16000 } },
        { id: 'local', max_model_len: 32768 },
        { id: 'deepseek-chat' },
      ],
    })
    expect(list).toEqual([{ id: 'deepseek-chat' }, { id: 'vendor/big', name: 'Big', contextWindow: 200000, maxOutput: 16000 }, { id: 'local', contextWindow: 32768 }])
  })
  it('reads anthropic limits and the effort levels the model supports', () => {
    const [m] = parseModels({
      data: [
        {
          id: 'claude-sonnet-5-5',
          display_name: 'Claude Sonnet 5.5',
          max_input_tokens: 1000000,
          max_tokens: 128000,
          capabilities: { effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: false }, max: { supported: true } } },
        },
      ],
    })
    expect(m).toEqual({ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', contextWindow: 1000000, maxOutput: 128000, efforts: ['low', 'medium', 'high', 'max'] })
  })
  it('accepts bare string lists and ignores junk', () => {
    expect(parseModels(['a', 'b', 'a', '', 5, null]).map((m) => m.id)).toEqual(['a', 'b'])
    expect(parseModels({ error: 'nope' })).toEqual([])
  })
  it('calls /models with the key, follows anthropic pagination and explains failures', async () => {
    const calls: { url: string; headers: any }[] = []
    const fetcher = (async (url: string, init: any) => {
      calls.push({ url, headers: init.headers })
      return json({ data: [{ id: 'm-a' }] })
    }) as unknown as typeof fetch
    expect((await fetchModels(profile(), fetcher)).map((m) => m.id)).toEqual(['m-a'])
    expect(calls[0]).toMatchObject({ url: 'https://api.example.com/v1/models', headers: { authorization: 'Bearer sk-test' } })

    const pages = [json({ data: [{ id: 'c1' }], has_more: true, last_id: 'c1' }), json({ data: [{ id: 'c2' }, { id: 'c1' }], has_more: false })]
    const urls: string[] = []
    const claude = (async (url: string, init: any) => {
      urls.push(url)
      expect(init.headers['x-api-key']).toBe('sk-test')
      return pages.shift()!
    }) as unknown as typeof fetch
    const got = await fetchModels(profile({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com' }), claude)
    expect(got.map((m) => m.id)).toEqual(['c1', 'c2'])
    expect(urls[1]).toContain('after_id=c1')

    const fail = (status: number) => (async () => json({ error: { message: 'bad key' } }, status)) as unknown as typeof fetch
    await expect(fetchModels(profile(), fail(401))).rejects.toThrow(/密钥无效/)
    await expect(fetchModels(profile(), fail(404))).rejects.toThrow(/没有提供模型列表/)
    await expect(fetchModels(profile({ baseUrl: 'file:///etc' }), fetcher)).rejects.toThrow(/http/)
  })
})

describe('request parameters third-party services reject', () => {
  const start = { json: true, tokenField: 'max_tokens' as const, temperature: true, effort: true, maxTokens: 8000 }
  it('drops or rewrites exactly what the error names', () => {
    expect(adjustWire(start, "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.")).toMatchObject({ tokenField: 'max_completion_tokens' })
    expect(adjustWire(start, "Unsupported value: 'temperature' does not support 0.4")).toMatchObject({ temperature: false })
    expect(adjustWire(start, 'Unknown parameter: reasoning_effort')).toMatchObject({ effort: true, json: false })
    expect(adjustWire(start, 'reasoning_effort rejected', true)).toMatchObject({ json: false }) // 检测时不去掉思考强度，退回去掉 JSON 模式
    expect(adjustWire(start, 'response_format json_object is not supported')).toMatchObject({ json: false })
    expect(adjustWire(start, 'max_tokens is too large: 8000. This model supports at most 4096 completion tokens')).toMatchObject({ maxTokens: 4096 })
    expect(adjustWire({ ...start, json: false }, 'something else')).toBeNull()
  })
  it('retries with the adjusted request, merges extra parameters but never overrides the model', async () => {
    const bodies: any[] = []
    const replies = [
      json({ error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } }, 400),
      json({ error: { message: "'temperature' does not support 0.4 with this model" } }, 400),
      json({ error: { message: 'Unknown parameter: response_format' } }, 400),
      json({ choices: [{ message: { content: '{"ok":true}' } }] }),
    ]
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body))
      return replies.shift()!
    })
    const text = await chatText('sys', 'user', { profile: profile({ extraBody: '{"enable_thinking":false,"model":"evil","messages":[]}', maxOutputTokens: 4000 }) })
    expect(text).toBe('{"ok":true}')
    expect(bodies).toHaveLength(4)
    expect(bodies[0]).toMatchObject({ model: 'm1', max_tokens: 4000, temperature: 0.4, enable_thinking: false, response_format: { type: 'json_object' } })
    expect(bodies[1]).toHaveProperty('max_completion_tokens', 4000)
    expect(bodies[1]).not.toHaveProperty('max_tokens')
    expect(bodies[2]).not.toHaveProperty('temperature')
    expect(bodies[3]).not.toHaveProperty('response_format')
    expect(bodies.every((b) => b.model === 'm1' && b.messages.length === 2)).toBe(true)
  })
  it('sends effort as output_config to anthropic without incompatible temperature', async () => {
    const bodies: any[] = []
    const replies = [json({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'hi' }] })]
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      bodies.push(JSON.parse(init.body))
      return replies.shift()!
    })
    const text = await chatText('s', 'u', { profile: profile({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', reasoningEffort: 'xhigh' }) })
    expect(text).toBe('hi')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).not.toHaveProperty('temperature')
    expect(bodies[0]).toMatchObject({ output_config: { effort: 'xhigh' } })
  })
  it('keeps real errors and does not loop forever', async () => {
    vi.stubGlobal('fetch', async () => json({ error: { message: 'invalid api key' } }, 401))
    await expect(chatText('s', 'u', { profile: profile() })).rejects.toThrow(/401.*invalid api key/)
    let n = 0
    vi.stubGlobal('fetch', async () => (n++, json({ error: { message: 'max_tokens problem 5000' } }, 400)))
    await expect(chatText('s', 'u', { profile: profile({ jsonMode: false }) })).rejects.toThrow(/400/)
    expect(n).toBeLessThan(8)
  })
})

describe('probing thinking effort', () => {
  const fake = (accept: string[], base = true) =>
    (async (_s: string, _u: string, o: { effort?: string }) => {
      if (o.effort === '' && !base) throw new Error('AI 请求失败 401: bad key')
      if (o.effort && !accept.includes(o.effort)) throw new Error(`AI 请求失败 400: Invalid value '${o.effort}' for reasoning_effort`)
      return ''
    }) as unknown as typeof chatText
  it('lists the accepted and rejected levels', async () => {
    const r = await probeEfforts(profile(), fake(['low', 'medium', 'high']))
    expect(r.supported).toEqual(['low', 'medium', 'high'])
    expect(r.rejected.map((x) => x.effort)).toEqual(['none', 'minimal', 'xhigh', 'max'])
    expect(r.rejected[0].message).toContain("Invalid value 'none'")
    expect(r.ignored).toBe(false)
  })
  it('says so when the service accepts anything, and when the base request already fails', async () => {
    const all = await probeEfforts(profile(), (async () => '') as unknown as typeof chatText)
    expect(all.ignored).toBe(true)
    expect(all.supported).toHaveLength(7)
    const bad = await probeEfforts(profile(), fake([], false))
    expect(bad.baseError).toContain('401')
    expect(bad.supported).toEqual([])
    const claude = await probeEfforts(profile({ provider: 'anthropic' }), fake(['low', 'high', 'max']))
    expect(claude.supported).toEqual(['low', 'high', 'max'])
  })
})
