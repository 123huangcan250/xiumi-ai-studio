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
const list = () => host.querySelector<HTMLSelectElement>('select[aria-label="可用模型"]')

it('shows fetched IDs in a visible selectable list without editing the existing model name', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'new-model', contextWindow: 128000 }, { id: 'other-model' }])
  await act(async () => fetchButton().click())
  expect(list()).not.toBeNull()
  expect(list()!.size).toBeGreaterThan(1)
  expect([...list()!.options].map((o) => o.value)).toContain('new-model')
  act(() => { list()!.value = 'new-model'; list()!.dispatchEvent(new Event('change', { bubbles: true })) })
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
  expect(list()!.options[1].value).toBe('retry-model')
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
it('imports the selected model limits and clears them for an unknown model', async () => {
  vi.mocked(api.aiModels).mockResolvedValue([{ id: 'new-model', contextWindow: 128000, maxOutput: 8192, efforts: ['low', 'high'] }])
  await act(async () => fetchButton().click())
  act(() => { list()!.value = 'new-model'; list()!.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(input('ai-max-output')?.value).toBe('8192')
  changeInput(input('ai-model'), 'custom-other-model')
  expect(input('ai-context').value).toBe('')
  expect(input('ai-max-output').value).toBe('')
  expect(input('ai-effort').value).toBe('')
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
  expect(list()!.options[1].value).toBe('retry')
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
  expect(list()!.options[1].value).toBe('new')
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
