// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../src/editor/api'
import { AiSettingsModal } from '../../src/editor/AiSettingsModal'

vi.mock('../../src/editor/api', () => ({ api: { aiSettings: vi.fn(), aiModels: vi.fn(), probeEffort: vi.fn(), testAi: vi.fn() } }))
let root: Root
let host: HTMLDivElement
const profiles = [
  { id: 'a', name: 'A', provider: 'openai', baseUrl: 'https://example.invalid/v1', apiKey: '', model: 'old-model', jsonMode: true },
  { id: 'b', name: 'B', provider: 'openai', baseUrl: 'https://other.invalid/v1', apiKey: '', model: '', jsonMode: true },
]
beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(api.aiSettings).mockResolvedValue({ activeId: 'a', profiles: profiles as any })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(AiSettingsModal, { onClose() {} })))
  act(() => host.querySelector<HTMLElement>('.ai-item')!.click())
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const fetchButton = () => host.querySelector<HTMLButtonElement>('[data-testid=ai-load-models]')!
const list = () => host.querySelector<HTMLElement>('[role="listbox"][aria-label="可用模型"]')
const picker = () => host.querySelector<HTMLButtonElement>('[data-testid="ai-model-picker"]')
const openPicker = () => { expect(picker()).not.toBeNull(); if (picker()!.getAttribute('aria-expanded') !== 'true') act(() => picker()!.click()) }
const options = () => { openPicker(); return [...list()!.querySelectorAll<HTMLElement>('[role="option"]')] }
const choose = (id: string) => { const option = options().find(o => o.title === id); expect(option).toBeTruthy(); act(() => option!.click()) }

it('shows fetched IDs in a visible selectable list without editing the existing model name', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'new-model', contextWindow: 128000 }, { id: 'other-model' }])
  await act(async () => fetchButton().click())
  expect(picker()!.getAttribute('aria-expanded')).toBe('false')
  expect(list()).toBeNull()
  expect(options().map(o => o.title)).toContain('new-model')
  choose('new-model')
  expect(host.querySelector<HTMLInputElement>('input[placeholder^="例如 deepseek-chat"]')!.value).toBe('new-model')
  expect(host.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('128000')
})

it('reports an empty list instead of rendering an invisible menu', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([])
  await act(async () => fetchButton().click())
  expect(host.querySelector('[role="status"]')!.textContent).toContain('服务未返回模型')
  expect(list()).toBeNull()
})

it('renders request failures visibly and permits a retry', async () => {
  vi.mocked(api.aiModels).mockRejectedValueOnce(new Error('模拟服务错误'))
  await act(async () => fetchButton().click())
  expect(host.querySelector('[role="status"]')!.textContent).toContain('模拟服务错误')
  expect(fetchButton().disabled).toBe(false)
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'retry-model' }])
  await act(async () => fetchButton().click())
  expect(options()[0].title).toBe('retry-model')
})

it('ignores late results after switching profiles', async () => {
  let resolve!: (models: { id: string }[]) => void
  vi.mocked(api.aiModels).mockReturnValue(new Promise((r) => { resolve = r }))
  await act(async () => fetchButton().click())
  expect(host.textContent).toContain('正在获取模型')
  act(() => host.querySelectorAll<HTMLElement>('.ai-item')[1].click())
  await act(async () => resolve([{ id: 'stale-model' }]))
  expect(list()).toBeNull()
  expect(host.textContent).not.toContain('stale-model')
})

const input = (id: string) => host.querySelector<HTMLInputElement>(`[data-testid="${id}"]`)!
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!
const changeInput = (el: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
it('imports selected model limits and preserves manual tuning when typing a model name', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'new-model', contextWindow: 128000, maxOutput: 8192, efforts: ['low', 'high'] }])
  await act(async () => fetchButton().click())
  choose('new-model')
  expect(input('ai-max-output')?.value).toBe('8192')
  changeInput(input('ai-effort'), 'high')
  changeInput(input('ai-model'), 'custom-other-model')
  expect(input('ai-context').value).toBe('128000')
  expect(input('ai-max-output').value).toBe('8192')
  expect(input('ai-effort').value).toBe('high')
})
it('ignores probe results after the model changes on the same profile', async () => {
  let finish!: (r: any) => void
  vi.mocked(api.probeEffort).mockReturnValue(new Promise((resolve) => { finish = resolve }))
  expect(button('检测支持的强度')).toBeDefined()
  await act(async () => button('检测支持的强度').click())
  changeInput(input('ai-model'), 'newer-model')
  await act(async () => finish({ supported: ['stale-effort'], rejected: [], ignored: false }))
  expect(host.textContent).not.toContain('stale-effort')
})
it('does not show an old connection result after switching profiles', async () => {
  let finish!: (r: any) => void
  vi.mocked(api.testAi).mockReturnValue(new Promise((resolve) => { finish = resolve }))
  await act(async () => button('测试连接').click())
  act(() => host.querySelectorAll<HTMLElement>('.ai-item')[1].click())
  await act(async () => finish({ ok: true, ms: 1, reply: {} }))
  expect(host.textContent).not.toContain('连接成功')
})
it('ignores model results after credentials change within one profile', async () => {
  let finish!: (r: any) => void
  vi.mocked(api.aiModels).mockReturnValue(new Promise((resolve) => { finish = resolve }))
  await act(async () => fetchButton().click())
  changeInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'new-key')
  await act(async () => finish([{ id: 'wrong-account-model' }]))
  expect(list()).toBeNull()
  expect(host.textContent).not.toContain('wrong-account-model')
})
it('clicking the current profile does not leave discovery stuck in a busy state', async () => {
  let finish!: (r: any) => void
  vi.mocked(api.aiModels).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  await act(async () => fetchButton().click())
  act(() => host.querySelector<HTMLElement>('.ai-item')!.click())
  await act(async () => finish([{ id: 'old' }]))
  expect(fetchButton().disabled).toBe(false)
  vi.mocked(api.aiModels).mockResolvedValueOnce([{ id: 'retry' }])
  await act(async () => fetchButton().click())
  expect(options()[0].title).toBe('retry')
})
it('keeps a newer discovery request busy when the superseded request completes', async () => {
  let first!: (r: any) => void
  let second!: (r: any) => void
  vi.mocked(api.aiModels).mockReturnValueOnce(new Promise((resolve) => { first = resolve })).mockReturnValueOnce(new Promise((resolve) => { second = resolve }))
  await act(async () => fetchButton().click())
  changeInput(host.querySelector<HTMLInputElement>('input[type="password"]')!, 'updated-key')
  await act(async () => fetchButton().click())
  await act(async () => first([{ id: 'old' }]))
  expect(fetchButton().disabled).toBe(true)
  await act(async () => second([{ id: 'new' }]))
  expect(options()[0].title).toBe('new')
  expect(fetchButton().disabled).toBe(false)
})
it('ignores discovery completion after closing the modal', async () => {
  let finish!: (r: any) => void
  vi.mocked(api.aiModels).mockReturnValue(new Promise((resolve) => { finish = resolve }))
  await act(async () => fetchButton().click())
  act(() => button('取消').click())
  await act(async () => finish([{ id: 'closed-result' }]))
  expect(list()).toBeNull()
  expect(host.textContent).not.toContain('closed-result')
})
it('does not publish a late probe or connection completion after unmount', async () => {
  let probe!: (r: any) => void
  let test!: (r: any) => void
  vi.mocked(api.probeEffort).mockReturnValue(new Promise((resolve) => { probe = resolve }))
  vi.mocked(api.testAi).mockReturnValue(new Promise((resolve) => { test = resolve }))
  await act(async () => { button('检测支持的强度').click(); button('测试连接').click() })
  act(() => root.unmount())
  await act(async () => { probe({ supported: ['high'], rejected: [], ignored: false }); test({ ok: true, ms: 1, reply: {} }) })
  expect(host.childElementCount).toBe(0)
  // Create an empty root for the common cleanup without calling unmount twice.
  root = createRoot(host)
})

const keyInput = () => host.querySelector<HTMLInputElement>('input[type="password"]')!
const baseInput = () => host.querySelector<HTMLInputElement>('input[placeholder="https://…/v1"]')!
const blur = async (el: HTMLElement) => { await act(async () => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))) }

it('discovers models after key editing finishes, never during mount, profile selection or typing', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'automatic-model' }])
  expect(api.aiModels).not.toHaveBeenCalled()
  await blur(keyInput())
  expect(api.aiModels).not.toHaveBeenCalled()
  changeInput(keyInput(), 'test-')
  changeInput(keyInput(), 'test-complete-key')
  expect(api.aiModels).not.toHaveBeenCalled()
  await blur(keyInput())
  expect(api.aiModels).toHaveBeenCalledTimes(1)
  expect(api.aiModels).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'test-complete-key', baseUrl: 'https://example.invalid/v1' }))
  expect(options()[0].title).toBe('automatic-model')
  await blur(keyInput())
  expect(api.aiModels).toHaveBeenCalledTimes(1)
  await act(async () => fetchButton().click())
  expect(api.aiModels).toHaveBeenCalledTimes(2)
})

it('waits for both a valid address and credentials before automatic discovery', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'completed-model' }])
  changeInput(baseInput(), '')
  changeInput(keyInput(), 'test-complete-key')
  await blur(keyInput())
  expect(api.aiModels).not.toHaveBeenCalled()
  changeInput(baseInput(), 'not-an-address')
  await blur(baseInput())
  expect(api.aiModels).not.toHaveBeenCalled()
  changeInput(baseInput(), 'https://new.invalid/v1')
  expect(api.aiModels).not.toHaveBeenCalled()
  await blur(baseInput())
  expect(api.aiModels).toHaveBeenCalledTimes(1)
  expect(options()[0].title).toBe('completed-model')
})

it('does not auto-discover a remote endpoint without a key but allows keyless loopback models', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'local-model' }])
  changeInput(baseInput(), 'https://new.invalid/v1')
  await blur(baseInput())
  expect(api.aiModels).not.toHaveBeenCalled()
  changeInput(baseInput(), 'http://127.0.0.1:11434/v1')
  await blur(baseInput())
  expect(api.aiModels).toHaveBeenCalledTimes(1)
  expect(options()[0].title).toBe('local-model')
})

it('keeps a typed key for same-origin paths but requires a new key after changing origin', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'same-origin-model' }])
  changeInput(keyInput(), 'test-old-origin-key')
  await blur(keyInput())
  changeInput(baseInput(), 'https://example.invalid/custom/v1')
  await blur(baseInput())
  expect(api.aiModels).toHaveBeenCalledTimes(2)
  expect(api.aiModels).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'test-old-origin-key' }))
  changeInput(baseInput(), '')
  changeInput(baseInput(), 'https://new.invalid/v1')
  await blur(baseInput())
  expect(api.aiModels).toHaveBeenCalledTimes(2)
  expect(keyInput().value).toBe('')
  changeInput(keyInput(), 'test-new-origin-key')
  await blur(keyInput())
  expect(api.aiModels).toHaveBeenCalledTimes(3)
  expect(api.aiModels).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'test-new-origin-key', baseUrl: 'https://new.invalid/v1' }))
})

it('requires a new key when switching provider even at the same origin', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'provider-model' }])
  changeInput(keyInput(), 'test-openai-key')
  await blur(keyInput())
  act(() => button('Anthropic Claude').click())
  expect(keyInput().value).toBe('')
  await blur(keyInput())
  expect(api.aiModels).toHaveBeenCalledTimes(1)
  changeInput(keyInput(), 'test-anthropic-key')
  await blur(keyInput())
  expect(api.aiModels).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'anthropic', apiKey: 'test-anthropic-key' }))
})

it('ignores late automatic discovery when credentials are edited again', async () => {
  let finish!: (r: any) => void
  vi.mocked(api.aiModels).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  changeInput(keyInput(), 'test-first-key')
  await blur(keyInput())
  expect(api.aiModels).toHaveBeenCalledTimes(1)
  changeInput(keyInput(), 'test-second-key')
  await act(async () => finish([{ id: 'stale-auto-model' }]))
  expect(list()).toBeNull()
  expect(host.textContent).not.toContain('stale-auto-model')
  vi.mocked(api.aiModels).mockResolvedValueOnce([{ id: 'latest-auto-model' }])
  await blur(keyInput())
  expect(options()[0].title).toBe('latest-auto-model')
})

it('does not auto-discover when key blur leads to another credential field or an explicit action', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'unexpected-model' }])
  changeInput(keyInput(), 'test-complete-key')
  await act(async () => keyInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: baseInput() })))
  expect(api.aiModels).not.toHaveBeenCalled()
  await act(async () => keyInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: button('Anthropic Claude') })))
  act(() => button('Anthropic Claude').click())
  expect(api.aiModels).not.toHaveBeenCalled()
  expect(keyInput().value).toBe('')
})

it('preserves a typed key through incomplete and temporary hostnames while editing a same-origin URL', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'same-origin-model' }])
  changeInput(keyInput(), 'test-old-origin-key')
  await blur(keyInput())
  for (const value of ['', 'https://', 'https://example', 'https://example.invalid/custom/v1']) changeInput(baseInput(), value)
  expect(keyInput().value).toBe('test-old-origin-key')
  expect(api.aiModels).toHaveBeenCalledTimes(1)
  await blur(baseInput())
  expect(api.aiModels).toHaveBeenCalledTimes(2)
  expect(api.aiModels).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'test-old-origin-key', baseUrl: 'https://example.invalid/custom/v1' }))
})

it('does not let another action resend a cleared draft key after an origin change', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'safe-model' }])
  changeInput(keyInput(), 'test-old-origin-key')
  await blur(keyInput())
  changeInput(baseInput(), 'https://new.invalid/v1')
  await blur(baseInput())
  await act(async () => fetchButton().click())
  expect(api.aiModels).toHaveBeenCalledTimes(1)
})

it('uses a saved key only for same-origin discovery and never just on opening the profile', async () => {
  act(() => root.unmount())
  vi.mocked(api.aiSettings).mockResolvedValue({ activeId: 'a', profiles: [{ ...profiles[0], apiKey: 'tes••••••cret', hasKey: true }] as any })
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'saved-key-model' }])
  root = createRoot(host)
  await act(async () => root.render(createElement(AiSettingsModal, { onClose() {} })))
  act(() => host.querySelector<HTMLElement>('.ai-item')!.click())
  expect(api.aiModels).not.toHaveBeenCalled()
  changeInput(baseInput(), 'https://example.invalid/custom/v1')
  await blur(baseInput())
  expect(api.aiModels).toHaveBeenCalledTimes(1)
  expect(options()[0].title).toBe('saved-key-model')
  changeInput(baseInput(), 'https://new.invalid/v1')
  await blur(baseInput())
  expect(api.aiModels).toHaveBeenCalledTimes(1)
  expect(keyInput().value).toBe('')
})


it('preserves tuning when rotating a key for the same provider', () => {
  changeInput(input('ai-context'), '128000')
  changeInput(input('ai-max-output'), '4096')
  changeInput(input('ai-effort'), 'high')
  changeInput(keyInput(), 'rotated-key')
  expect(input('ai-context').value).toBe('128000')
  expect(input('ai-max-output').value).toBe('4096')
  expect(input('ai-effort').value).toBe('high')
})

it('allows an explicitly cleared key to discover a local provider after changing origin', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'local-model' }])
  changeInput(keyInput(), 'old-key')
  changeInput(baseInput(), 'http://localhost:11434/v1')
  changeInput(keyInput(), '')
  await act(async () => fetchButton().click())
  expect(api.aiModels).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '', hasKey: false, baseUrl: 'http://localhost:11434/v1' }))
  expect(options()[0].title).toBe('local-model')
})

it('names ignored extra parameters visibly instead of silently dropping them', () => {
  const el = host.querySelector<HTMLTextAreaElement>('[data-testid="ai-extra-body"]')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, '{"temperature":2,"max_tokens":500,"enable_thinking":false}')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const warning = host.querySelector('[data-testid="ai-extra-ignored"]')
  expect(warning?.textContent).toContain('temperature')
  expect(warning?.textContent).toContain('max_tokens')
  expect(warning?.textContent).not.toContain('enable_thinking')
})

it('does not overwrite manual context tuning when key rotation refreshes matching model metadata', async () => {
  changeInput(input('ai-context'), '64000')
  changeInput(input('ai-max-output'), '4096')
  changeInput(input('ai-effort'), 'high')
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'old-model', contextWindow: 128000, maxOutput: 16000, efforts: ['low'] }])
  changeInput(keyInput(), 'rotated-key')
  await blur(keyInput())
  expect(input('ai-context').value).toBe('64000')
  expect(input('ai-max-output').value).toBe('4096')
  expect(input('ai-effort').value).toBe('high')
})

it('keeps tuning through same-origin path editing and an incomplete URL draft',()=>{
 changeInput(host.querySelector<HTMLInputElement>('[data-testid="ai-context"]')!,'128000')
 changeInput(host.querySelector<HTMLInputElement>('[data-testid="ai-max-output"]')!,'8192')
 changeInput(host.querySelector<HTMLInputElement>('[data-testid="ai-effort"]')!,'high')
 for(const value of ['https://','https://example.invalid/custom/v1/']) changeInput(baseInput(),value)
 expect(host.querySelector<HTMLInputElement>('[data-testid="ai-context"]')!.value).toBe('128000')
 expect(host.querySelector<HTMLInputElement>('[data-testid="ai-max-output"]')!.value).toBe('8192')
 expect(host.querySelector<HTMLInputElement>('[data-testid="ai-effort"]')!.value).toBe('high')
})

it('clears service metadata on a committed cross-origin discovery without changing ordinary same-origin edits',async()=>{
 changeInput(host.querySelector<HTMLInputElement>('[data-testid="ai-context"]')!,'128000')
 changeInput(host.querySelector<HTMLInputElement>('[data-testid="ai-max-output"]')!,'8192')
 changeInput(host.querySelector<HTMLInputElement>('[data-testid="ai-effort"]')!,'high')
 changeInput(baseInput(),'http://localhost:11434/v1')
 vi.mocked(api.aiModels).mockResolvedValue([])
 await blur(baseInput())
 expect(api.aiModels).toHaveBeenCalledWith(expect.objectContaining({contextWindow:0,maxOutputTokens:0,reasoningEffort:''}))
 expect(host.querySelector<HTMLInputElement>('[data-testid="ai-context"]')!.value).toBe('')
})

it('does not send requests to invalid or credential-bearing draft URLs',async()=>{
 for(const address of ['https://','ftp://example.invalid','https://user:pass@example.invalid']) {
  changeInput(baseInput(),address)
  expect(fetchButton().disabled).toBe(true)
  expect(button('测试连接').disabled).toBe(true)
  await blur(baseInput())
 }
 expect(api.aiModels).not.toHaveBeenCalled();expect(api.testAi).not.toHaveBeenCalled()
})

const key = (value: string) => act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })))
it('keeps 40 models folded and supports keyboard selection without changing manual tuning', async () => {
  vi.mocked(api.aiModels).mockResolvedValue(Array.from({length:40}, (_,i) => ({id:`model-${i}`,contextWindow:128000+i,maxOutput:4096+i,efforts:['high']})))
  await act(async () => fetchButton().click())
  expect(list()).toBeNull()
  picker()!.focus(); key('ArrowDown'); key('End')
  expect(list()!.querySelectorAll('[role="option"]')).toHaveLength(40)
  expect(list()!.getAttribute('aria-activedescendant')).toBe(list()!.querySelector('[data-active="true"]')!.id)
  expect(input('ai-model').value).toBe('old-model')
  key('Enter')
  expect(input('ai-model').value).toBe('model-39'); expect(input('ai-context').value).toBe('128039')
  expect(input('ai-max-output').value).toBe('4135'); expect(document.activeElement).toBe(picker())
  changeInput(input('ai-effort'),'high'); changeInput(input('ai-model'),'handwritten')
  expect(input('ai-context').value).toBe('128039'); expect(input('ai-max-output').value).toBe('4135'); expect(input('ai-effort').value).toBe('high')
})
it('Escape dismisses only the open picker before the settings modal', async () => {
  const close=vi.fn(); await act(async () => root.render(createElement(AiSettingsModal,{onClose:close})))
  vi.mocked(api.aiModels).mockResolvedValue([{id:'a'}]); await act(async () => fetchButton().click())
  openPicker(); key('Escape'); expect(list()).toBeNull(); expect(close).not.toHaveBeenCalled(); expect(document.activeElement).toBe(picker())
  key('Escape'); expect(close).toHaveBeenCalledTimes(1)
})
