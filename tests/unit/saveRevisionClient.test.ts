// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../src/editor/api'
import * as store from '../../src/editor/store'
beforeEach(()=>{vi.useFakeTimers();store.useStore.getState().load({...store.emptyDoc(),revision:'r1'} as any)})
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks()})
it('keeps server revision independent of undo snapshots',async()=>{
 const save=vi.spyOn(api,'saveProject').mockResolvedValue({updatedAt:1,revision:'r2'} as any)
 store.useStore.getState().setDocFields({title:'edit'}); await store.saveNow(); store.useStore.getState().undo(); await store.saveNow()
 expect((save.mock.calls[1][0] as any).revision).toBe('r2')
})
it('retains conflict edits and writes an explicit new-ID copy rather than forcing overwrite',async()=>{
 const original=store.useStore.getState().doc
 const save=vi.spyOn(api,'saveProject').mockRejectedValue(Object.assign(new Error('conflict'),{status:409}))
 await store.saveNow(); expect((store.useStore.getState() as any).saveConflict).toBe(true)
 store.useStore.getState().setDocFields({title:'keep local'})
 await store.saveNow(); expect(save).toHaveBeenCalledTimes(1)
 save.mockResolvedValue({updatedAt:2,revision:'copy-r1'} as any)
 expect(await (store as any).saveConflictCopy()).toBe(true)
 expect(store.useStore.getState().doc.id).not.toBe(original.id)
 expect(store.useStore.getState().doc.title).toContain('keep local')
 expect((store.useStore.getState() as any).savedRevision).toBe('copy-r1')
})
it('clears the previous multi-selection and uses only the newly loaded save revision', async () => {
 const a = store.useStore.getState().insertBlock('paragraph')
 const b = store.useStore.getState().insertBlock('paragraph')
 store.useStore.getState().select(a, { toggle: true })
 expect(store.useStore.getState().selectedIds).toEqual([b, a])
 const save = vi.spyOn(api, 'saveProject').mockRejectedValueOnce(Object.assign(new Error('old conflict'), { status: 409 }))
 await store.saveNow()
 expect(store.useStore.getState().saveConflict).toBe(true)
 const next = { ...store.emptyDoc(), revision: 'new-r1' }
 store.useStore.getState().load(next)
 expect(store.useStore.getState().selectedIds).toEqual([])
 expect(store.useStore.getState().selectedId).toBeNull()
 expect(store.useStore.getState().saveConflict).toBe(false)
 save.mockResolvedValueOnce({ updatedAt: 2, revision: 'new-r2' })
 store.useStore.getState().setDocFields({ title: 'new document edit' })
 await store.saveNow()
 expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ id: next.id, revision: 'new-r1' }))
 expect(store.useStore.getState().savedRevision).toBe('new-r2')
})
