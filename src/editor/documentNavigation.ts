import type { Doc } from '../core/types'
import { useStore } from './store'
/** A delayed read must not replace newer edits, undo history, or a different document. */
export function loadIfUnchanged(next: Doc, expected: Doc): boolean {
  const state = useStore.getState()
  if (state.doc !== expected) {
    state.notify('等待期间文档已变化，已保留当前内容。请保存后重试切换。', 'error')
    return false
  }
  state.load(next)
  return true
}
