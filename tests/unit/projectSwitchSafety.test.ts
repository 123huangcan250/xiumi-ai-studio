// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { LeftPanel } from '../../src/editor/LeftPanel'
import { api } from '../../src/editor/api'
import { emptyDoc, useStore } from '../../src/editor/store'

let root: ReturnType<typeof createRoot> | undefined
let host: HTMLElement | undefined
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

it('preserves edits made while a requested project is still loading', async () => {
  vi.useFakeTimers()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const original = { ...emptyDoc(), title: '原稿A' }
  const target = { ...emptyDoc(), title: '目标B' }
  useStore.getState().load(original)
  vi.spyOn(api, 'assets').mockResolvedValue([])
  vi.spyOn(api, 'templates').mockResolvedValue([])
  vi.spyOn(api, 'projects').mockResolvedValue([{ ...target, blockCount: target.blocks.length }])
  vi.spyOn(api, 'saveProject').mockResolvedValue({ updatedAt: Date.now() })
  let finish!: (doc: typeof target) => void
  vi.spyOn(api, 'project').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root!.render(createElement(LeftPanel)) })
  await act(async () => { (host!.querySelector('[data-testid="tab-projects"]') as HTMLElement).click() })
  const targetButton = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('目标B'))!
  await act(async () => { targetButton.click() })
  await act(async () => { useStore.getState().setDocFields({ title: '加载期间新编辑' }) })
  await act(async () => { finish(target) })
  expect(useStore.getState().doc.id).toBe(original.id)
  expect(useStore.getState().doc.title).toBe('加载期间新编辑')
  expect(useStore.getState().past.length).toBeGreaterThan(0)
})
