// @vitest-environment jsdom
// Component integration: real App startup, API client and document store; leaf UI is isolated.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { emptyDoc, useStore } from '../../src/editor/store'
vi.mock('../../src/editor/Canvas', () => ({ Canvas: () => null }))
vi.mock('../../src/editor/LeftPanel', () => ({ LeftPanel: () => null }))
vi.mock('../../src/editor/RightPanel', () => ({ RightPanel: () => null }))
vi.mock('../../src/editor/Toolbar', () => ({ Toolbar: () => null }))
vi.mock('../../src/editor/Workspace', () => ({ Workspace: ({ children }: any) => children }))
vi.mock('../../src/editor/CollectModal', () => ({ CollectHost: () => null }))
vi.mock('../../src/editor/ReplayPreview', () => ({ ReplayHost: () => null }))
let root: Root, host: HTMLDivElement
let writes: any[]
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useStore.getState().load({ ...emptyDoc(), id: 'original-memory', title: 'Do not replace' })
  useStore.setState({ toast: null })
  writes = []; host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); useStore.getState().load(emptyDoc()) })
function transport(body: unknown, failure?: Error) {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { const doc = JSON.parse(init.body as string); writes.push(doc); return Response.json({ ...doc, revision: 'r1' }) }
    if (url === '/api/projects') return failure ? { ok: true, status: 200, json: async () => { throw failure } } : Response.json(body)
    if (url === '/api/themes') return Response.json([])
    throw new Error('Unexpected request: ' + url)
  })
}
it.each([{}, { length: 0 }, '', 'wrong', null])('does not create a project from non-array response %j', async body => {
  transport(body)
  await act(async () => root.render(createElement(App)))
  expect(writes).toEqual([])
  expect(useStore.getState().doc.id).toBe('original-memory')
  expect(useStore.getState().toast?.kind).toBe('error')
})
it.each([new DOMException('cancelled body', 'AbortError'), new SyntaxError('broken body')])('does not create after body failure %s', async error => {
  transport(undefined, error)
  await act(async () => root.render(createElement(App)))
  expect(writes).toEqual([])
  expect(useStore.getState().doc.title).toBe('Do not replace')
  expect(useStore.getState().toast?.text).toContain(error.message)
})
it('creates and saves the first project only from an actual empty array', async () => {
  transport([])
  await act(async () => root.render(createElement(App)))
  expect(writes).toHaveLength(1)
  expect(useStore.getState().doc.id).toBe(writes[0].id)
  expect(useStore.getState().savedRevision).toBe('r1')
  expect(useStore.getState().saveStatus).toBe('saved')
})
it('ignores malformed responses after the startup effect is unmounted', async () => {
  let deliver!: (value: Response) => void
  vi.stubGlobal('fetch', async (url: string) => url === '/api/projects' ? new Promise<Response>(resolve => { deliver = resolve }) : Response.json([]))
  await act(async () => root.render(createElement(App)))
  await act(async () => root.render(null))
  await act(async () => deliver(Response.json({ length: 0 })))
  expect(useStore.getState().toast).toBeNull()
  expect(useStore.getState().doc.id).toBe('original-memory')
})
it('does not replace edits made while the valid empty list was pending', async () => {
  let deliver!: (value: Response) => void
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { writes.push(init.body); return Response.json({}) }
    return url === '/api/projects' ? new Promise<Response>(resolve => { deliver = resolve }) : Response.json([])
  })
  await act(async () => root.render(createElement(App)))
  act(() => useStore.setState({ doc: { ...useStore.getState().doc, title: 'New work during startup' } }))
  await act(async () => deliver(Response.json([])))
  expect(writes).toEqual([])
  expect(useStore.getState().doc.title).toBe('New work during startup')
})
