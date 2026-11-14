import { useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { selectedBlock, useStore } from './store'

type Scope = 'selection' | 'document'
/** Selection identity, not object identity: ordinary edits must not reset a manual override. */
function selectionKey() {
  const state = useStore.getState(), block = selectedBlock(state)
  return JSON.stringify([state.doc.id, block?.id ?? null, block?.type ?? null])
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
  const automatic: Scope = selectedBlock(useStore.getState()) ? 'selection' : 'document'
  const [choice, setChoice] = useState({ version, scope: automatic })
  // Derive immediately. Do not let children/handlers see a previous scope until an effect runs.
  const scope = choice.version === version ? choice.scope : automatic
  useLayoutEffect(() => { tracker.mount(); return tracker.unmount }, [tracker])
  const setScope = (next: Scope) => {
    tracker.choose()
    setChoice({ version: tracker.snapshot(), scope: selectedBlock(useStore.getState()) ? next : 'document' })
  }
  return { scope, setScope, scopeIdentity: tracker.token(), captureScope: tracker.token, isScopeCurrent: tracker.current }
}
