import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useStore } from './store'
import { findBlock } from '../core/tree'

type Scope = 'selection' | 'document'
/** Selection identity, not object identity: ordinary edits must not reset a manual override. */
function selectionKey() {
  const state = useStore.getState()
  const members = state.selectedIds.map(id => findBlock(state.doc.blocks, id)?.block).filter(b => !!b).map(b => [b.id, b.type]).sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  return JSON.stringify([state.doc.id, members])
}

/** Per-mounted-panel epochs observe every store transition, including batched A -> B -> A. */
export function useSelectionScope() {
  const tracker = useMemo(() => {
    let key = selectionKey(), version = 0, manual = 0, lifetime = 0, alive = true
    const snapshot = () => {
      const next = selectionKey()
      if (next !== key) { key = next; version++ }
      return version
    }
    return {
      snapshot,
      subscribe: (notify: () => void) => useStore.subscribe(() => {
        const previous = version
        if (snapshot() !== previous) notify()
      }),
      choose: () => { manual++ },
      token: () => `${snapshot()}:${manual}:${lifetime}`,
      current: (token: string) => alive && token === `${snapshot()}:${manual}:${lifetime}`,
      mount: () => { alive = true },
      unmount: () => { alive = false; lifetime++ },
    }
  }, [])
  const version = useSyncExternalStore(tracker.subscribe, tracker.snapshot, tracker.snapshot)
  const automatic: Scope = useStore.getState().selectedIds.length ? 'selection' : 'document'
  const [choice, setChoice] = useState({ version, scope: automatic })
  // Derive immediately. Do not let children/handlers see a previous scope until an effect runs.
  const scope = choice.version === version ? choice.scope : automatic
  useLayoutEffect(() => { tracker.mount(); return tracker.unmount }, [tracker])
  const setScope = (next: Scope) => {
    tracker.choose()
    setChoice({ version: tracker.snapshot(), scope: useStore.getState().selectedIds.length ? next : 'document' })
  }
  return { scope, setScope, scopeIdentity: tracker.token(), captureScope: tracker.token, isScopeCurrent: tracker.current }
}
