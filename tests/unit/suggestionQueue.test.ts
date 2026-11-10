import { expect, it, vi } from 'vitest'
import { SuggestionQueue } from '../../src/editor/suggestionQueue'
it('caches suggestions and avoids duplicate model calls', async () => {
  const fetch = vi.fn(async () => ({ suggestion: '精简开头' }))
  const queue = new SuggestionQueue(0)
  expect(await queue.get('doc', fetch, new AbortController().signal)).toBe('精简开头')
  expect(await queue.get('doc', fetch, new AbortController().signal)).toBe('精简开头')
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('never starts a stale queued request', async () => {
  let finish!: (value: { suggestion: string }) => void
  const queue = new SuggestionQueue(0)
  const first = queue.get('old', () => new Promise(resolve => { finish = resolve }), new AbortController().signal)
  const controller = new AbortController()
  const fetch = vi.fn(async () => ({ suggestion: '过期建议' }))
  const second = queue.get('new', fetch, controller.signal)
  controller.abort()
  finish({ suggestion: '旧建议' })
  await first
  await second
  expect(fetch).not.toHaveBeenCalled()
})
it('enforces the minimum interval and does not automatically retry failures', async () => {
  vi.useFakeTimers()
  try {
    const queue = new SuggestionQueue(30_000)
    await queue.get('a', async () => ({ suggestion: 'first' }), new AbortController().signal)
    const fetch = vi.fn(async () => ({ suggestion: 'second' }))
    const pending = queue.get('b', fetch, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(fetch).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBe('second')
    const failing = vi.fn(async (): Promise<{ suggestion: string }> => { throw new Error('offline') })
    const failure = queue.get('c', failing, new AbortController().signal)
    const check = expect(failure).rejects.toThrow('offline')
    await vi.advanceTimersByTimeAsync(30_000)
    await check
    expect(await queue.get('c', failing, new AbortController().signal)).toBe('')
    expect(failing).toHaveBeenCalledTimes(1)
  } finally { vi.useRealTimers() }
})
it('invalidates a failed context after settings change', async () => {
  const queue = new SuggestionQueue(0)
  await expect(queue.get('a', async () => { throw new Error('bad key') }, new AbortController().signal)).rejects.toThrow()
  queue.clear()
  expect(await queue.get('a', async () => ({ suggestion: 'new credentials' }), new AbortController().signal)).toBe('new credentials')
})
it('invalidates cached failures from global settings events even without an AI panel', async () => {
  const { listenForAiSettings, instructionSuggestions } = await import('../../src/editor/suggestionQueue')
  const target = new EventTarget()
  const before = instructionSuggestions.revision
  const stop = listenForAiSettings(target)
  target.dispatchEvent(new Event('ai-settings-changed'))
  expect(instructionSuggestions.revision).toBe(before + 1)
  stop()
  target.dispatchEvent(new Event('ai-settings-changed'))
  expect(instructionSuggestions.revision).toBe(before + 1)
})
