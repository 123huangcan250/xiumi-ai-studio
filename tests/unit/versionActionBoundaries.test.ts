// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ state: {} as any, f: {} as Record<string, any>, listeners: new Set<() => void>(), subscriptions: new Set<(next: any, previous: any) => void>(), parts: 1, report: {} as any }))
vi.mock('../../src/editor/store', async () => {
 const { useSyncExternalStore } = await import('react')
 return { useStore: Object.assign((select: any) => select(useSyncExternalStore(cb => { h.listeners.add(cb); return () => { h.listeners.delete(cb) } }, () => h.state)), { getState: () => h.state, subscribe: (listener: (next: any, previous: any) => void) => { h.subscriptions.add(listener); return () => { h.subscriptions.delete(listener) } } }), normalizeDoc: (d: any) => h.f.normalizeDoc(d), flushSave: () => h.f.flushSave(), saveNow: () => h.f.saveNow(), saveConflictCopy: () => h.f.saveConflictCopy() }
})
vi.mock('../../src/editor/api', () => ({ api: Object.fromEntries(['appInfo','quit','versions','version','saveVersion','wechatStatus','wechatDraft'].map(k => [k, (...args: any[]) => h.f[k](...args)])) }))
vi.mock('../../src/core/compiler', () => ({ compileDoc: (...args: any[]) => h.f.compileDoc(...args), variantUrl: (src: string) => src }))
vi.mock('../../src/core/exporters', () => ({ docToMarkdown: (...args: any[]) => h.f.docToMarkdown(...args) }))
vi.mock('../../src/core/images', () => ({ displayHtml: (html: string) => html }))
vi.mock('../../src/core/xiumiExport', () => ({ splitForXiumi: () => Array.from({ length: h.parts }, () => 'part'), xiumiSvgBoxes: (html: string) => html, xiumiReport: () => h.report }))
vi.mock('../../src/editor/wechatOutput', () => ({ ...Object.fromEntries(['assertReplayOk','compileForWechat','copyRichText','download','standaloneHtml','xiumiPackage','prepareXiumiUpload'].map(k => [k, (...args: any[]) => h.f[k](...args)])) }))
vi.mock('../../src/editor/Modal', () => ({ Modal: ({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) => createElement('section', {'aria-label':title}, createElement('button',{'aria-label':`关闭${title}`,onClick:onClose},'关闭'),children) }))
vi.mock('../../src/editor/DataModal', () => ({ DataModal: () => createElement('span',null,'数据子流程') }))
vi.mock('../../src/editor/AiSettingsModal', () => ({ AiSettingsModal: () => createElement('span',null,'设置子流程') }))
vi.mock('../../src/editor/ArticleImport', () => ({ ArticleImportModal: () => createElement('span',null,'导入子流程') }))
vi.mock('../../src/editor/ImportWizard', () => ({ ImportWizard: () => createElement('span',null,'排版子流程') }))
import { Toolbar } from '../../src/editor/Toolbar'
let host: HTMLDivElement, root: Root
const deferred = <T,>() => { let resolve!: (v: T) => void; let reject!: (e: unknown) => void; const promise = new Promise<T>((a,b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const button = (text: string) => { const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text); expect(found).toBeDefined(); return found! }
const click = async (el: Element) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click() }) }
const close = async (title: string) => { await click(host.querySelector<HTMLButtonElement>(`[aria-label="关闭${title}"]`)!) }
const update = (patch: any) => act(() => { const previous = h.state; h.state = { ...h.state, ...patch }; for (const listener of h.subscriptions) listener(h.state, previous); for (const listener of h.listeners) listener() })
const openVersions = () => click(button('历史版本'))
beforeEach(async () => {
 vi.clearAllMocks(); h.listeners.clear(); h.subscriptions.clear(); h.parts = 1; h.report = { localImages: 1, backgrounds: 0, dataImages: 0, localBackgrounds: 0 }; h.f = {}
 for (const name of ['appInfo','quit','versions','version','saveVersion','wechatStatus','wechatDraft','normalizeDoc','flushSave','saveNow','saveConflictCopy','compileDoc','docToMarkdown','assertReplayOk','compileForWechat','copyRichText','download','standaloneHtml','xiumiPackage','prepareXiumiUpload']) h.f[name] = vi.fn(() => { throw Error(`Unconfigured boundary: ${name}`) })
 h.state = { doc: { id: 'current', title: 'Title/安全', author: 'Author', digest: 'Digest', cover: { src: '/media/cover.jpg' }, blocks: [] }, saveStatus: 'saved', saveError: '', saveConflict: false, past: [], future: [], undo: vi.fn(), redo: vi.fn(), setDocFields: vi.fn(), notify: vi.fn(), commit: vi.fn() }
 h.f.appInfo.mockResolvedValue({ canQuit: true }); h.f.quit.mockResolvedValue({}); h.f.flushSave.mockResolvedValue(undefined); h.f.saveNow.mockReturnValue(undefined); h.f.saveConflictCopy.mockResolvedValue(undefined)
 h.f.versions.mockResolvedValue([{ id: 'v', label: 'Saved version', createdAt: 1, blockCount: 2 }]); h.f.normalizeDoc.mockImplementation((d: any) => ({ ...d, normalized: true })); h.f.wechatStatus.mockResolvedValue({ configured: true }); h.f.compileDoc.mockReturnValue({ html: '<p>synthetic</p>', charCount: 20 }); h.f.assertReplayOk.mockImplementation((r: any) => r)
 vi.stubGlobal('confirm', vi.fn(() => true)); vi.stubGlobal('prompt', vi.fn(() => 'label')); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
 host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(createElement(Toolbar)))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('does not launch duplicate version persistence while the first save remains pending', async () => {
 const saving = deferred<void>(); h.f.saveVersion.mockReturnValue(saving.promise); await openVersions(); await click(button('保存当前为新版本')); await click(button('保存当前为新版本'))
 try { expect(h.f.saveVersion).toHaveBeenCalledTimes(1) } finally { await act(async () => saving.resolve()) }
})
it('version save rejection is reported without success feedback or refreshing the list', async () => {
 h.f.saveVersion.mockRejectedValue(Error('synthetic version save rejected'))
 await openVersions(); await click(button('保存当前为新版本'))
 await vi.waitFor(() => expect(h.state.notify).toHaveBeenCalledWith('synthetic version save rejected', 'error'))
 expect(h.f.versions).toHaveBeenCalledTimes(1); expect(h.state.notify).not.toHaveBeenCalledWith('版本已保存'); expect(h.state.commit).not.toHaveBeenCalled()
})
it('version restore rejection is reported without committing or closing the dialog', async () => {
 h.f.version.mockRejectedValue(Error('synthetic restore rejected'))
 await openVersions(); await click(button('恢复'))
 await vi.waitFor(() => expect(h.state.notify).toHaveBeenCalledWith('synthetic restore rejected', 'error'))
 expect(h.state.commit).not.toHaveBeenCalled(); expect(host.querySelector('[aria-label="历史版本"]')).not.toBeNull()
})
it('same-render duplicate clicks are admitted once before React can disable the version button', async () => {
 const saving = deferred<void>(); h.f.saveVersion.mockReturnValue(saving.promise); await openVersions(); const save = button('保存当前为新版本')
 await act(async () => { save.click(); save.click() })
 try { expect(h.f.saveVersion).toHaveBeenCalledTimes(1) } finally { await act(async () => saving.resolve()) }
})
it('version save failure releases admission for an explicit retry', async () => {
 h.f.saveVersion.mockRejectedValueOnce(Error('retryable')).mockResolvedValueOnce({})
 await openVersions(); await click(button('保存当前为新版本')); await vi.waitFor(() => expect(h.state.notify).toHaveBeenCalledWith('retryable', 'error'))
 expect(button('保存当前为新版本').disabled).toBe(false); await click(button('保存当前为新版本')); expect(h.f.saveVersion).toHaveBeenCalledTimes(2); expect(h.state.notify).toHaveBeenCalledWith('版本已保存')
})
it.each(['close','edit'])('late successful version save after %s cannot refresh or notify the new context', async reason => {
 const saving = deferred<void>(); h.f.saveVersion.mockReturnValue(saving.promise); await openVersions(); await click(button('保存当前为新版本'))
 if (reason === 'close') await close('历史版本'); else update({ doc: { ...h.state.doc, title: 'new editing' } })
 await act(async () => saving.resolve()); expect(h.f.versions).toHaveBeenCalledTimes(1); expect(h.state.notify).not.toHaveBeenCalled(); expect(h.state.commit).not.toHaveBeenCalled()
})
it('successful persistence followed by refresh failure reports both facts without resaving', async () => {
 h.f.saveVersion.mockResolvedValue({}); await openVersions(); h.f.versions.mockRejectedValue(Error('list unavailable'))
 await click(button('保存当前为新版本')); expect(h.state.notify).toHaveBeenCalledWith('版本已保存'); expect(h.state.notify).toHaveBeenCalledWith('加载版本列表失败：list unavailable', 'error'); expect(h.f.saveVersion).toHaveBeenCalledTimes(1)
})
it('changing document starts a new version list and ignores the old list response', async () => {
 const oldList = deferred<any>(); h.f.versions.mockReturnValueOnce(oldList.promise).mockResolvedValueOnce([{ id: 'new-version', label: 'New list', createdAt: 1, blockCount: 1 }])
 await openVersions(); update({ doc: { ...h.state.doc, id: 'second-document' } }); await act(async () => { await Promise.resolve() })
 await act(async () => oldList.resolve([{ id: 'old-version', label: 'Old list', createdAt: 1, blockCount: 1 }]))
 expect(h.f.versions).toHaveBeenLastCalledWith('second-document'); expect(host.textContent).toContain('New list'); expect(host.textContent).not.toContain('Old list')
})
it('pending version save is not presented as current success after document identity leaves and returns', async () => {
 const saving = deferred<void>(); h.f.saveVersion.mockReturnValue(saving.promise); const original = h.state.doc
 await openVersions(); await click(button('保存当前为新版本')); update({ doc: { ...original, id: 'other' } }); update({ doc: original })
 const listCalls = h.f.versions.mock.calls.length; await act(async () => saving.resolve())
 expect(h.state.notify).not.toHaveBeenCalled(); expect(h.f.versions).toHaveBeenCalledTimes(listCalls)
})
it('restore failure after a newer edit of the same document does not notify the new context', async () => {
 const old = deferred<any>(); h.f.version.mockReturnValue(old.promise); await openVersions(); await click(button('恢复')); update({ doc: { ...h.state.doc, title: 'new local edit' } })
 await act(async () => old.reject(Error('stale restore failure'))); expect(h.state.notify).not.toHaveBeenCalled(); expect(h.state.commit).not.toHaveBeenCalled()
})
it('same-act document ABA also invalidates pending version save completion', async () => {
 const saving = deferred<void>(); h.f.saveVersion.mockReturnValue(saving.promise); const original = h.state.doc
 await openVersions(); await click(button('保存当前为新版本')); act(() => { update({ doc: { ...original, id: 'other' } }); update({ doc: original }) })
 await act(async () => saving.resolve()); expect(h.state.notify).not.toHaveBeenCalled(); expect(h.f.versions).toHaveBeenCalledTimes(1)
})
it('old version list rejection after changing document cannot notify the new context', async () => {
 const oldList = deferred<any>(); h.f.versions.mockReturnValueOnce(oldList.promise).mockResolvedValueOnce([{ id: 'v2', label: 'New list', createdAt: 1, blockCount: 1 }])
 await openVersions(); update({ doc: { ...h.state.doc, id: 'new' } }); await act(async () => oldList.reject(Error('old list failed')))
 expect(h.state.notify).not.toHaveBeenCalled(); expect(host.textContent).toContain('New list')
})
it('older restore rejection after a newer restore succeeds is silent', async () => {
 const first = deferred<any>(), second = deferred<any>(); h.f.version.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
 await openVersions(); await click(button('恢复')); await click(button('恢复')); await act(async () => second.resolve({ doc: { id: 'old', title: 'selected' } })); h.state.notify.mockClear()
 await act(async () => first.reject(Error('superseded'))); expect(h.state.notify).not.toHaveBeenCalled(); expect(h.state.commit).toHaveBeenCalledTimes(1)
})
it('initial version list still becomes available after same-act document ABA', async () => {
 const initial = deferred<any>(); h.f.versions.mockReturnValue(initial.promise); const original = h.state.doc
 await openVersions(); act(() => { update({ doc: { ...original, id: 'other' } }); update({ doc: original }) })
 await act(async () => initial.resolve([{ id: 'v', label: 'Returned A list', createdAt: 1, blockCount: 2 }]))
 expect(host.textContent).toContain('Returned A list'); expect(host.textContent).not.toContain('还没有保存过版本')
})
