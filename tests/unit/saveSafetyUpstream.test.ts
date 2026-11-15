// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../src/editor/api'
import { emptyDoc, flushSave, saveNow, useStore } from '../../src/editor/store'
beforeEach(() => { vi.useFakeTimers(); useStore.getState().load(emptyDoc()) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
it('reports failure without discarding the current draft', async () => {
  useStore.getState().setDocFields({ title: 'unsaved draft' })
  const before = useStore.getState().doc
  vi.spyOn(api, 'saveProject').mockRejectedValue(new Error('disk full'))
  expect(await saveNow()).toBe(false)
  expect(useStore.getState().doc).toBe(before)
  await expect(flushSave()).rejects.toThrow('disk full')
})
it('does not let an old save failure poison a newly loaded project', async () => {
  let reject!: (error: Error) => void
  vi.spyOn(api, 'saveProject').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
  const saving = saveNow()
  await Promise.resolve()
  const next = emptyDoc()
  useStore.getState().load(next)
  reject(new Error('old request failed'))
  await saving
  expect(useStore.getState().doc.id).toBe(next.id)
  expect(useStore.getState().saveStatus).toBe('saved')
  expect(useStore.getState().saveError).toBe('')
})
it('keeps navigation blocked when editing during a successful save', async () => {
  let finish!: (value: { updatedAt: number }) => void
  vi.spyOn(api, 'saveProject').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const saving = saveNow()
  await Promise.resolve()
  useStore.getState().setDocFields({ title: 'newer edit' })
  finish({ updatedAt: 1 })
  expect(await saving).toBe(false)
  expect(useStore.getState().saveStatus).toBe('dirty')
})
