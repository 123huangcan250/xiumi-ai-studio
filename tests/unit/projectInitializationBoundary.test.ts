// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ toast: null, load: vi.fn(), notify: vi.fn(), saveStatus: 'saved' }))
const save = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../src/editor/store', () => ({
  useStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), { getState: () => state }),
  emptyDoc: () => ({ id: 'unexpected-empty', blocks: [] }), loadCustomThemes: vi.fn(async () => {}), saveNow: save,
}))
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: ReactNode }) => children, DragOverlay: () => null,
  MeasuringStrategy: { Always: 0 }, PointerSensor: class {}, closestCenter: vi.fn(), pointerWithin: vi.fn(), useSensor: vi.fn(), useSensors: () => [],
}))
vi.mock('../../src/editor/Canvas', () => ({ Canvas: () => null, photoTarget: vi.fn(), shownRatio: vi.fn(), slotTarget: vi.fn() }))
vi.mock('../../src/editor/CollectModal', () => ({ CollectHost: () => null }))
vi.mock('../../src/editor/componentActions', () => ({ insertComponent: vi.fn() }))
vi.mock('../../src/editor/LeftPanel', () => ({ LeftPanel: () => null }))
vi.mock('../../src/editor/RightPanel', () => ({ RightPanel: () => null }))
vi.mock('../../src/editor/Toolbar', () => ({ Toolbar: () => null }))
vi.mock('../../src/editor/ReplayPreview', () => ({ ReplayHost: () => null }))
vi.mock('../../src/editor/Workspace', () => ({ Workspace: ({ children }: { children: ReactNode }) => children }))
import App from '../../src/App'
import { api } from '../../src/editor/api'
let root: Root | undefined
let host: HTMLDivElement
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div'); document.body.append(host)
})
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined; host.remove(); vi.unstubAllGlobals()
})
async function mount() {
  root = createRoot(host)
  await act(async () => { root!.render(createElement(App)); await new Promise(resolve => setTimeout(resolve, 0)) })
}
it.each([{}, { length: 0 }, '', null])('never creates a new document from a non-array project response %j', async data => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => data })))
  await mount()
  expect(save).not.toHaveBeenCalled()
  expect(state.load).not.toHaveBeenCalled()
  expect(state.notify).toHaveBeenCalled()
})
it('preserves AbortError identity when a successful JSON body is interrupted', async () => {
  const error = new DOMException('navigation body cancelled', 'AbortError')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw error } })))
  await expect(api.projects()).rejects.toBe(error)
  await mount()
  expect(save).not.toHaveBeenCalled()
  expect(state.load).not.toHaveBeenCalled()
})
it('rejects malformed successful JSON rather than synthesizing an empty object', async () => {
  const error = new SyntaxError('incomplete JSON')
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw error } })))
  await expect(api.projects()).rejects.toBe(error)
})
it('still creates and saves on a verified empty array', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })))
  await mount(); expect(state.load).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledTimes(1)
})
it.each([{ error: 'specific failure' }, null])('preserves non-success HTTP error handling %j', async data => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, statusText: 'Unavailable', json: async () => { if (data === null) throw new SyntaxError('not JSON'); return data } })))
  await expect(api.projects()).rejects.toThrow(data?.error ?? '503 Unavailable')
})
it.each([204, 205])('preserves explicit %s no-content compatibility', async status => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status, json: async () => { throw new SyntaxError('empty') } })))
  await expect(api.deleteProject('sample')).resolves.toEqual({})
})
