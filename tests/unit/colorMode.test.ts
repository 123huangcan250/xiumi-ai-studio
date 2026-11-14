// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ColorModeControl, ColorModeProvider } from '../../src/editor/ColorModeControl'
import { COLOR_MODE_KEY, readColorMode, resolveColorMode } from '../../src/editor/colorMode'


let root: Root | undefined
let host: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 10, 12))
  localStorage.clear()
  delete document.documentElement.dataset.colorMode
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  host.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function mount() {
  root = createRoot(host)
  act(() => root!.render(createElement(ColorModeProvider, null, createElement(ColorModeControl))))
}

function choose(value: string) {
  const select = host.querySelector('select')!
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('local day/night boundaries', () => {
  it.each([
    [0, 0, 'dark'], [6, 59, 'dark'], [7, 0, 'light'],
    [18, 59, 'light'], [19, 0, 'dark'], [23, 59, 'dark'],
  ] as const)('uses local %i:%i as %s', (hour, minute, expected) => {
    expect(resolveColorMode('auto', new Date(2026, 10, 10, hour, minute))).toBe(expected)
  })

  it('keeps manual light and dark choices at the opposite time of day', () => {
    expect(resolveColorMode('light', new Date(2026, 10, 10, 23))).toBe('light')
    expect(resolveColorMode('dark', new Date(2026, 10, 10, 12))).toBe('dark')
  })

  it('rejects an invalid stored choice and defaults to local automatic mode', () => {
    expect(readColorMode()).toBe('auto')
    localStorage.setItem(COLOR_MODE_KEY, 'system')
    expect(readColorMode()).toBe('auto')
    localStorage.setItem(COLOR_MODE_KEY, 'dark')
    expect(readColorMode()).toBe('dark')
  })
})

it('starts automatic, allows both manual choices, and restores a saved choice on remount', () => {
  mount()
  expect(host.querySelector('select')!.value).toBe('auto')
  expect(document.documentElement.dataset.colorMode).toBe('light')
  expect(host.querySelector('select')!.getAttribute('aria-label')).toBe('界面主题')
  choose('dark')
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  expect(localStorage.getItem(COLOR_MODE_KEY)).toBe('dark')
  choose('light')
  expect(document.documentElement.dataset.colorMode).toBe('light')
  choose('dark')
  act(() => root!.unmount())
  mount()
  expect(host.querySelector('select')!.value).toBe('dark')
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it('switches automatically across dawn and dusk while the page is open', () => {
  vi.setSystemTime(new Date(2026, 10, 10, 6, 59, 30))
  mount()
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  act(() => vi.advanceTimersByTime(60_000))
  expect(document.documentElement.dataset.colorMode).toBe('light')
  vi.setSystemTime(new Date(2026, 10, 10, 18, 59, 30))
  act(() => vi.advanceTimersByTime(60_000))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it.each(['focus', 'pageshow'])('rechecks local clock changes immediately on %s', (event) => {
  mount()
  vi.setSystemTime(new Date(2026, 10, 10, 23))
  act(() => window.dispatchEvent(new Event(event)))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it('rechecks on foreground visibility and keeps manual choices after clock changes', () => {
  mount()
  vi.setSystemTime(new Date(2026, 10, 10, 23))
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  choose('light')
  act(() => vi.advanceTimersByTime(120_000))
  act(() => window.dispatchEvent(new Event('focus')))
  expect(document.documentElement.dataset.colorMode).toBe('light')
  choose('auto')
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it('uses fresh local wall time rather than a cached timezone or UTC hour', () => {
  mount()
  // Simulate the operating system changing its timezone while this tab remains open.
  vi.spyOn(Date.prototype, 'getHours').mockReturnValue(23)
  act(() => vi.advanceTimersByTime(60_000))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  vi.mocked(Date.prototype.getHours).mockReturnValue(8)
  act(() => window.dispatchEvent(new Event('focus')))
  expect(document.documentElement.dataset.colorMode).toBe('light')
})

it('syncs preference changes from other tabs and resets when storage is cleared', () => {
  mount()
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: COLOR_MODE_KEY, newValue: 'dark', storageArea: localStorage })))
  expect(host.querySelector('select')!.value).toBe('dark')
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'light', storageArea: localStorage })))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null, storageArea: localStorage })))
  expect(host.querySelector('select')!.value).toBe('auto')
  expect(document.documentElement.dataset.colorMode).toBe('light')
})

it('ignores same-key changes from session storage', () => {
  mount()
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: COLOR_MODE_KEY, newValue: 'dark', storageArea: sessionStorage })))
  expect(document.documentElement.dataset.colorMode).toBe('light')
})

it('still renders and switches modes when browser storage is denied', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
  expect(readColorMode()).toBe('auto')
  mount()
  choose('dark')
  expect(host.querySelector('select')!.value).toBe('dark')
  expect(document.documentElement.dataset.colorMode).toBe('dark')
  act(() => window.dispatchEvent(new Event('focus')))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it('retains a manual choice for this page when saving it exceeds the storage quota', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
  mount()
  choose('dark')
  act(() => window.dispatchEvent(new Event('focus')))
  expect(document.documentElement.dataset.colorMode).toBe('dark')
})

it('removes timers and listeners on unmount', () => {
  mount()
  act(() => root!.unmount())
  root = undefined
  document.documentElement.dataset.colorMode = 'light'
  vi.setSystemTime(new Date(2026, 10, 10, 23))
  act(() => {
    vi.advanceTimersByTime(120_000)
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new StorageEvent('storage', { key: COLOR_MODE_KEY, newValue: 'dark', storageArea: localStorage }))
  })
  expect(document.documentElement.dataset.colorMode).toBe('light')
  expect(vi.getTimerCount()).toBe(0)
})
