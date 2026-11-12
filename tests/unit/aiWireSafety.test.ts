import { afterEach, expect, it, vi } from 'vitest'
import { chatJson, chatText, testConnection } from '../../server/ai'
import { fetchModels, parseModels, probeEfforts } from '../../server/aiModels'
import type { AiProfile } from '../../server/settings'
const p = (over: Partial<AiProfile> = {}): AiProfile => ({ id: 'p', name: 'P', provider: 'openai', baseUrl: 'https://api.example/v1', apiKey: 'test-key', model: 'm', jsonMode: true, ...over })
afterEach(() => vi.unstubAllGlobals())
it.each(['openai', 'anthropic'] as const)('blocks redirects and keeps controlled fields authoritative for %s', async (provider) => {
  let sent: any
  let url = ''
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    url = input; sent = init
    return Response.json(provider === 'openai' ? { choices: [{ message: { content: '{}' } }] } : { content: [{ text: '{}' }] })
  })
  await chatJson('sys', 'user', { profile: p({ provider, reasoningEffort: 'high', maxOutputTokens: 2048, extraBody: JSON.stringify({ max_tokens: 99999, max_completion_tokens: 99999, temperature: 2, reasoning_effort: 'low', output_config: { effort: 'low', format: 'vendor' }, response_format: { type: 'text' }, model: 'evil', messages: [], enable_thinking: true }) }) })
  const b = JSON.parse(sent.body)
  expect(sent.redirect).toBe('error')
  expect(b.model).toBe('m')
  expect(b.temperature).toBeUndefined()
  expect(b.enable_thinking).toBe(true)
  if (provider === 'openai') {
    expect(b.max_tokens).toBe(2048); expect(b.max_completion_tokens).toBeUndefined()
    expect(b.reasoning_effort).toBe('high'); expect(b.response_format).toEqual({ type: 'json_object' })
  } else {
    expect(url).toBe('https://api.example/v1/messages'); expect(b.max_tokens).toBe(2048)
    expect(b.max_completion_tokens).toBeUndefined(); expect(b.output_config).toMatchObject({ effort: 'high' })
  }
})
it('never silently drops explicitly requested reasoning', async () => {
  let n = 0
  vi.stubGlobal('fetch', async () => { n++; return Response.json({ error: { message: 'Unsupported reasoning_effort' } }, { status: 400 }) })
  await expect(chatText('s', 'u', { profile: p({ reasoningEffort: 'high' }) })).rejects.toThrow(/reasoning_effort/)
  expect(n).toBeLessThanOrEqual(2)
})
it.each(['openai', 'anthropic'] as const)('reports truncated %s output instead of parsing partial JSON', async (provider) => {
  vi.stubGlobal('fetch', async () => Response.json(provider === 'openai' ? { choices: [{ finish_reason: 'length', message: { content: '{}' } }] } : { stop_reason: 'max_tokens', content: [{ text: '{}' }] }))
  await expect(chatJson('s', 'u', { profile: p({ provider }) })).rejects.toThrow(/token 上限/)
})
it('preserves the reasoning connection budget under the configured cap', async () => {
  let body: any
  vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] }) })
  await testConnection(p({ reasoningEffort: 'high', maxOutputTokens: 3000 }))
  expect(body.max_tokens).toBe(3000)
  expect(body.temperature).toBeUndefined()
})
it('normalizes Anthropic discovery paths and preserves legacy effort metadata', async () => {
  let path = ''
  const fetcher = (async (u: string, init: RequestInit) => { path = u; expect(init.redirect).toBe('error'); return Response.json({ data: [{ id: 'm', reasoning_efforts: ['low', 'high', 'bad effort'] }] }) }) as typeof fetch
  const [model] = await fetchModels(p({ provider: 'anthropic' }), fetcher)
  expect(new URL(path).pathname).toBe('/v1/models')
  expect(model.efforts).toEqual(['low', 'high'])
  expect(parseModels([' ', 'a'])).toEqual([{ id: 'a' }])
})
it('does not let extra parameters override the invalid-effort control probe, and accepts truncated probe responses', async () => {
  const efforts: unknown[] = []
  vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); efforts.push(body.reasoning_effort)
    return body.reasoning_effort === 'not-a-level' ? Response.json({ error: { message: 'Invalid reasoning_effort' } }, { status: 400 }) : Response.json({ choices: [{ finish_reason: 'length', message: { content: '' } }] })
  })
  const r = await probeEfforts(p({ extraBody: '{"reasoning_effort":"high"}' }))
  expect(r.baseError).toBeUndefined(); expect(r.ignored).toBe(false)
  expect(efforts).toContain('not-a-level'); expect(efforts[0]).toBeUndefined()
  expect(r.supported).toContain('high')
})
it('bounds bare-string provider model lists just like object model lists', () => {
  expect(parseModels(Array.from({ length: 600 }, (_, i) => `m${i}`))).toHaveLength(500)
})

it.each([
  "Unsupported parameter: 'max_completion_tokens'. Use 'max_tokens' instead.",
  "Unknown parameter: max_completion_tokens",
])('adapts reasoning to a legacy token field without dropping effort: %s', async (message) => {
  const bodies: any[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.redirect).toBe('error')
    const body = JSON.parse(String(init.body)); bodies.push(body)
    return 'max_completion_tokens' in body
      ? Response.json({ error: { message } }, { status: 400 })
      : Response.json({ choices: [{ message: { content: '{"ok":true}' } }] })
  })
  await expect(chatJson('s', 'u', { profile: p({ baseUrl: 'https://api.openai.com/v1', reasoningEffort: 'high', maxOutputTokens: 2048 }) })).resolves.toEqual({ ok: true })
  expect(bodies).toHaveLength(2)
  expect(bodies[0].max_completion_tokens).toBe(2048)
  expect(bodies[1].max_tokens).toBe(2048)
  expect(bodies[1].max_completion_tokens).toBeUndefined()
  expect(bodies.every((b) => b.reasoning_effort === 'high' && b.temperature === undefined)).toBe(true)
})

it('does not switch token field when the provider only asks for a smaller completion budget', async () => {
  const bodies: any[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); bodies.push(body)
    return body.max_completion_tokens > 4096
      ? Response.json({ error: { message: 'max_completion_tokens is too large: 8000. Maximum output tokens: 4096' } }, { status: 400 })
      : Response.json({ choices: [{ message: { content: 'ok' } }] })
  })
  await expect(chatText('s', 'u', { profile: p({ baseUrl: 'https://api.openai.com/v1', reasoningEffort: 'high' }) })).resolves.toBe('ok')
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toMatchObject({ max_completion_tokens: 4096, reasoning_effort: 'high' })
  expect(bodies[1].max_tokens).toBeUndefined()
})

it('still reports rejected effort after adapting the token field', async () => {
  const bodies: any[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); bodies.push(body)
    return Response.json({ error: { message: 'max_completion_tokens' in body ? 'Unsupported parameter: max_completion_tokens. Use max_tokens instead.' : 'Unsupported reasoning_effort' } }, { status: 400 })
  })
  await expect(chatText('s', 'u', { profile: p({ reasoningEffort: 'high' }) })).rejects.toThrow(/reasoning_effort/)
  expect(bodies.some((b) => b.max_tokens)).toBe(true)
  expect(bodies.every((b) => b.reasoning_effort === 'high')).toBe(true)
})

it('stops with the provider error if both token fields are rejected instead of cycling', async () => {
  const fields: string[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    const field = 'max_completion_tokens' in body ? 'max_completion_tokens' : 'max_tokens'
    fields.push(field)
    return Response.json({ error: { message: `Unknown parameter: ${field}` } }, { status: 400 })
  })
  await expect(chatText('s', 'u', { profile: p({ baseUrl: 'https://api.openai.com/v1', reasoningEffort: 'high', jsonMode: false }) })).rejects.toThrow(/Unknown parameter: max_tokens/)
  expect(fields).toEqual(['max_completion_tokens', 'max_tokens'])
})

it('probes legacy-token providers without misreporting accepted or rejected effort levels', async () => {
  const bodies: any[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); bodies.push(body)
    if ('max_completion_tokens' in body) return Response.json({ error: { message: 'Unsupported parameter: max_completion_tokens. Use max_tokens instead.' } }, { status: 422 })
    if (body.reasoning_effort && !['low', 'high'].includes(body.reasoning_effort)) return Response.json({ error: { message: 'Invalid reasoning_effort' } }, { status: 400 })
    return Response.json({ choices: [{ message: { content: 'ok' } }] })
  })
  const result = await probeEfforts(p())
  expect(result.baseError).toBeUndefined()
  expect(result.ignored).toBe(false)
  expect(result.supported).toEqual(['low', 'high'])
  expect(result.rejected.map((entry) => entry.effort)).toEqual(['none', 'minimal', 'medium', 'xhigh', 'max'])
  // Compatible providers now receive max_tokens immediately, with no needless field retry.
  expect(bodies.filter((body) => body.reasoning_effort === 'not-a-level')).toHaveLength(1)
  expect(bodies.filter((body) => !body.reasoning_effort)).toHaveLength(1)
})


it.each(['https://api.deepseek.com/v1', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'http://localhost:11434/v1', 'https://api.openai.com.evil.invalid/v1'])('sends the compatible token budget first at %s even with reasoning enabled', async (baseUrl) => {
  const bodies: any[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)))
    return Response.json({ choices: [{ message: { content: '{}' } }] })
  })
  await chatJson('s', 'u', { profile: p({ baseUrl, reasoningEffort: 'high', maxOutputTokens: 2048 }) })
  expect(bodies).toHaveLength(1)
  expect(bodies[0]).toMatchObject({ max_tokens: 2048, reasoning_effort: 'high' })
  expect(bodies[0].max_completion_tokens).toBeUndefined()
})

it('does not leave a timeout active when a reasoning profile has an invalid URL', async () => {
  vi.useFakeTimers()
  try {
    vi.stubGlobal('fetch', async () => { throw new TypeError('Invalid URL') })
    await expect(chatText('s', 'u', { profile: p({ baseUrl: 'not-a-url', reasoningEffort: 'high' }) })).rejects.toThrow()
    expect(vi.getTimerCount()).toBe(0)
  } finally { vi.useRealTimers() }
})
