import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

// 使用临时数据目录，避免覆盖本机的真实设置
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'xiumi-settings-'))
delete process.env.AI_API_KEY

let settings: typeof import('../../server/settings')
beforeAll(async () => {
  settings = await import('../../server/settings')
})

describe('ai settings', () => {
  it('masks keys and keeps the stored key when the masked value is sent back', async () => {
    const saved = await settings.saveAiSettings({
      activeId: 'a',
      profiles: [{ id: 'a', name: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com/v1/', apiKey: 'sk-1234567890abcd', model: 'deepseek-chat', jsonMode: true }],
    })
    const pub = saved.profiles[0]
    expect(pub.apiKey).not.toContain('1234567890')
    expect(pub.apiKey.endsWith('abcd')).toBe(true)
    expect(pub.baseUrl).toBe('https://api.deepseek.com/v1')

    await settings.saveAiSettings({ activeId: 'a', profiles: [{ ...pub, name: '改名' }] })
    const p = await settings.getProfile()
    expect(p?.apiKey).toBe('sk-1234567890abcd')
    expect(p?.name).toBe('改名')
  })
  it('picks the active profile', async () => {
    await settings.saveAiSettings({
      activeId: 'b',
      profiles: [
        { id: 'a', name: 'A', provider: 'openai', baseUrl: 'http://a', apiKey: 'k1', model: 'm1', jsonMode: true },
        { id: 'b', name: 'B', provider: 'anthropic', baseUrl: 'http://b', apiKey: 'k2', model: 'm2', jsonMode: false },
      ],
    })
    expect((await settings.getProfile())?.name).toBe('B')
    expect((await settings.getProfile('a'))?.name).toBe('A')
  })
  it('stores effort, context window, output limit and extra parameters, and cleans untrusted values', async () => {
    const saved = await settings.saveAiSettings({
      activeId: 'e',
      profiles: [
        { id: 'e', name: 'E', provider: 'openai', baseUrl: 'http://e', apiKey: 'k', model: 'm', jsonMode: true, reasoningEffort: 'High', efforts: ['low', 'high', 'low', 'x y', '', 'Medium'], contextWindow: 128000.7, maxOutputTokens: -5, extraBody: '{"enable_thinking": false}' },
        { id: 'f', name: 'F', provider: 'openai', baseUrl: 'http://f', apiKey: 'k', model: 'm', jsonMode: true, reasoningEffort: 'drop table;', extraBody: '[1,2]' },
        { id: 'g', name: 'G', provider: 'openai', baseUrl: 'http://g', apiKey: 'k', model: 'm', jsonMode: true, extraBody: 'not json' },
      ],
    })
    const [e, f, g] = saved.profiles
    expect(e).toMatchObject({ reasoningEffort: 'high', efforts: ['low', 'high', 'medium'], contextWindow: 128000, maxOutputTokens: 0, extraBody: '{"enable_thinking":false}' })
    expect(f).toMatchObject({ reasoningEffort: '', extraBody: '' })
    expect(g.extraBody).toBe('')
    // 临时测试的配置：没传的字段沿用已保存的
    const draft = await settings.resolveDraftProfile({ id: 'e', baseUrl: 'http://e', model: 'm2' })
    expect(draft).toMatchObject({ reasoningEffort: 'high', contextWindow: 128000, efforts: ['low', 'high', 'medium'] })
    expect(await settings.resolveDraftProfile({ id: 'e', reasoningEffort: '' })).toMatchObject({ reasoningEffort: '' })
  })
})
