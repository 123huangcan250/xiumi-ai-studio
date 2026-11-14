// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import * as quickActions from '../../src/core/quickActions'
import { textToRich } from '../../src/core/richtext'
import { api } from '../../src/editor/api'
import { RightPanel } from '../../src/editor/RightPanel'
import { instructionSuggestions } from '../../src/editor/suggestionQueue'
import { emptyDoc, useStore } from '../../src/editor/store'

let root: Root
let host: HTMLDivElement
let now = Date.now()
const status = { enabled: true, name: 'Mock', model: 'mock', profileId: 'test', provider: 'openai' }
const first = { ...createBlock('paragraph', { content: textToRich('春季校园活动将于下周举行。') }), id: 'first-paragraph' }
const second = { ...createBlock('paragraph', { content: textToRich('请携带个人入场凭证。') }), id: 'second-paragraph' }
const tab = async (name: string) => act(async () => host.querySelector<HTMLButtonElement>(`[data-testid="tab-${name}"]`)!.click())
const toggle = () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
const input = () => host.querySelector<HTMLTextAreaElement>('textarea[aria-label="AI 修改指令"]')!
const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const setInput = (value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input(), value)
  input().dispatchEvent(new Event('input', { bubbles: true }))
})

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(now += 120_000)
  localStorage.clear()
  instructionSuggestions.clear()
  vi.spyOn(api, 'aiStatus').mockResolvedValue(status)
  vi.spyOn(api, 'aiSuggestInstruction').mockResolvedValue({ suggestion: '精简选中段落，保留活动事实' })
  vi.spyOn(api, 'aiEdit').mockResolvedValue({ summary: '建议', ops: [] })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useStore.getState().load({ ...emptyDoc(), blocks: [first, second] })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(RightPanel)))
  await tab('ai')
  act(() => useStore.getState().select(first.id))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('never sends suggestion requests by default, including after a scope change or remount', async () => {
  expect(toggle().checked).toBe(false)
  await advance(60_000)
  act(() => useStore.getState().select(second.id))
  await tab('theme')
  await tab('ai')
  await advance(60_000)
  expect(toggle().checked).toBe(false)
  expect(api.aiSuggestInstruction).not.toHaveBeenCalled()
})
it('associates the opt-in with a warning about sending text to a model and API costs', () => {
  const warningId = toggle().getAttribute('aria-describedby')
  expect(warningId).toBeTruthy()
  const warning = document.getElementById(warningId!)
  expect(warning?.textContent).toContain('发送')
  expect(warning?.textContent).toContain('模型')
  expect(warning?.textContent).toContain('费用')
})
it('labels the selected scope with a readable type and content snippet, not its internal id', () => {
  const option = host.querySelector<HTMLOptionElement>('option[value="selection"]')!
  expect(option.textContent).toContain('正文')
  expect(option.textContent).toContain('春季校园活动将于下周举行。')
  expect(option.textContent).not.toContain(first.id)
  expect(option.textContent).not.toContain('paragraph')
})
it('persists explicit opt-in and opt-out across AI panel remounts', async () => {
  act(() => toggle().click())
  await advance(1500)
  expect(api.aiSuggestInstruction).toHaveBeenCalledTimes(1)
  expect(vi.mocked(api.aiSuggestInstruction).mock.calls[0][0]).toMatchObject({ blocks: [{ id: first.id }] })
  expect(vi.mocked(api.aiSuggestInstruction).mock.calls[0][2]).toBe(first.id)
  expect(input().value).toBe('')
  expect(input().placeholder).toBe('精简选中段落，保留活动事实')
  expect(api.aiEdit).not.toHaveBeenCalled()
  await tab('theme')
  await tab('ai')
  expect(toggle().checked).toBe(true)
  act(() => toggle().click())
  await tab('theme')
  await tab('ai')
  expect(toggle().checked).toBe(false)
  act(() => useStore.getState().select(second.id))
  await advance(60_000)
  expect(api.aiSuggestInstruction).toHaveBeenCalledTimes(1)
})
it('cancels the debounce when opted out before the first request', async () => {
  act(() => toggle().click())
  await advance(1000)
  act(() => toggle().click())
  await advance(60_000)
  expect(api.aiSuggestInstruction).not.toHaveBeenCalled()
})
it.each(['selection', 'document', 'model', 'off'] as const)('ignores a late response after changing %s', async (change) => {
  let finish!: (value: { suggestion: string }) => void
  vi.mocked(api.aiSuggestInstruction).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  act(() => toggle().click())
  await advance(1500)
  expect(api.aiSuggestInstruction).toHaveBeenCalledTimes(1)
  if (change === 'selection') act(() => useStore.getState().select(second.id))
  if (change === 'document') act(() => useStore.getState().setDocFields({ title: '新的文章标题' }))
  if (change === 'model') {
    vi.mocked(api.aiStatus).mockResolvedValue({ ...status, profileId: 'new', model: 'new-model' })
    await act(async () => window.dispatchEvent(new Event('ai-settings-changed')))
  }
  if (change === 'off') act(() => toggle().click())
  await act(async () => finish({ suggestion: '过期的输入建议' }))
  expect(input().placeholder).not.toBe('过期的输入建议')
  act(() => input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })))
  expect(input().value).toBe('')
})
it('preserves manual text when an outstanding suggestion finishes', async () => {
  let finish!: (value: { suggestion: string }) => void
  vi.mocked(api.aiSuggestInstruction).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  act(() => toggle().click())
  await advance(1500)
  setInput('我的修改要求')
  await act(async () => finish({ suggestion: '不能覆盖手动输入' }))
  expect(input().value).toBe('我的修改要求')
  expect(input().placeholder).not.toBe('不能覆盖手动输入')
  expect(api.aiEdit).not.toHaveBeenCalled()
})
it('never starts a queued request after opting out during an in-flight request', async () => {
  let finish!: (value: { suggestion: string }) => void
  vi.mocked(api.aiSuggestInstruction).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  act(() => toggle().click())
  await advance(1500)
  act(() => useStore.getState().select(second.id))
  await advance(1500)
  act(() => toggle().click())
  await act(async () => finish({ suggestion: '已关闭的建议' }))
  await advance(60_000)
  expect(api.aiSuggestInstruction).toHaveBeenCalledTimes(1)
  expect(input().placeholder).not.toBe('已关闭的建议')
})

it('does not build article context while suggestions are disabled', async () => {
  const buildContext = vi.spyOn(quickActions, 'aiContext')
  act(() => useStore.getState().setDocFields({ title: '不需要计算建议上下文' }))
  expect(buildContext).not.toHaveBeenCalled()
  act(() => toggle().click())
  expect(buildContext).toHaveBeenCalledTimes(1)
  act(() => toggle().click())
  buildContext.mockClear()
  act(() => useStore.getState().setDocFields({ title: '再次关闭' }))
  expect(buildContext).not.toHaveBeenCalled()
})
