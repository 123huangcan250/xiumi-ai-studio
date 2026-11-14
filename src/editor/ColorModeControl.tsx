import { UiIcon } from './UiIcon'
import { createContext, useContext, useEffect, useId, useLayoutEffect, useState, type ReactNode } from 'react'
import { Help } from './Help'
import { COLOR_MODE_KEY, parseColorMode, readColorMode, resolveColorMode, saveColorMode, type ColorModePreference, type ResolvedColorMode } from './colorMode'

type ColorModeState = {
  preference: ColorModePreference
  resolved: ResolvedColorMode
  setPreference: (preference: ColorModePreference) => void
}

const ColorModeContext = createContext<ColorModeState | null>(null)

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [preference, setStoredPreference] = useState(readColorMode)
  const [localMode, setLocalMode] = useState(() => resolveColorMode('auto'))
  const resolved = preference === 'auto' ? localMode : preference

  useLayoutEffect(() => {
    document.documentElement.dataset.colorMode = resolved
  }, [resolved])

  useEffect(() => {
    const refresh = () => setLocalMode(resolveColorMode('auto'))
    // A minute-aligned check catches day/night, clock, timezone and DST changes without
    // caching an offset. Focus/visibility/pageshow also recover suspended mobile tabs.
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      refresh()
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000))
    }
    tick()
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', refresh)
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== COLOR_MODE_KEY) return
      try {
        if (event.storageArea !== window.localStorage) return
      } catch {
        return
      }
      setStoredPreference(parseColorMode(event.newValue))
      refresh()
    }
    window.addEventListener('storage', sync)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const setPreference = (next: ColorModePreference) => {
    setStoredPreference(next)
    setLocalMode(resolveColorMode('auto'))
    saveColorMode(next)
  }

  return <ColorModeContext.Provider value={{ preference, resolved, setPreference }}>{children}</ColorModeContext.Provider>
}

/** A native select remains keyboard, screen-reader and touch accessible on narrow screens. */
export function ColorModeControl() {
  const state = useContext(ColorModeContext)
  const descriptionId = useId()
  if (!state) return null
  return (
    <div className="color-mode-control">
      <Help title="界面主题">按设备本地时间，07:00–19:00 为浅色，其余时间为深色。也可手动选择并记住，仅改变界面，不影响文章和导出。</Help>
      <UiIcon name="settings" />
      <select aria-label="界面主题" aria-describedby={descriptionId} data-testid="color-mode-select" value={state.preference}
        onChange={(event) => state.setPreference(parseColorMode(event.target.value))}>
        <option value="auto">自动 · 本地昼夜</option>
        <option value="light">浅色</option>
        <option value="dark">深色</option>
      </select>
      <span id={descriptionId} className="color-mode-description">按设备本地时间，07:00–19:00 为浅色，其余时间为深色；手动选择会记住。仅改变界面，不影响文章和导出。</span>
    </div>
  )
}
