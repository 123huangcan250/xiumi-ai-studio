import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { parseUiTheme, readUiTheme, resolveUiTheme, UI_THEME_KEY, UI_THEME_OPTIONS, type UiThemePreference } from './uiTheme'

type Choice = { preference: UiThemePreference; select: (value: UiThemePreference) => void }
const UiThemeContext = createContext<Choice | null>(null)
const read = () => readUiTheme(key => window.localStorage.getItem(key))

export function UiThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(read)
  const [time, setTime] = useState(() => new Date())
  const theme = resolveUiTheme(preference, time)
  useLayoutEffect(() => {
    const root = document.documentElement
    if (theme === 'upstream') delete root.dataset.uiTheme
    else root.dataset.uiTheme = theme
    if (theme === 'mono-dark') root.dataset.colorMode = 'dark'
    else delete root.dataset.colorMode
  }, [theme])
  useEffect(() => {
    const update = () => setTime(new Date())
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== UI_THEME_KEY) return
      try {
        if (event.storageArea !== window.localStorage) return
        setPreference(read())
        update()
      } catch { /* storage can be unavailable */ }
    }
    const timer = window.setInterval(update, 60_000)
    window.addEventListener('focus', update)
    window.addEventListener('pageshow', update)
    window.addEventListener('storage', sync)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', update)
      window.removeEventListener('pageshow', update)
      window.removeEventListener('storage', sync)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  const select = (value: UiThemePreference) => {
    setPreference(value)
    setTime(new Date())
    try { window.localStorage.setItem(UI_THEME_KEY, value) } catch { /* session-only fallback */ }
  }
  return <UiThemeContext.Provider value={{ preference, select }}>{children}</UiThemeContext.Provider>
}

export function UiThemeControl() {
  const theme = useContext(UiThemeContext)
  if (!theme) return null
  return (
    <label className="field">
      <span>界面主题</span>
      <select value={theme.preference} onChange={event => theme.select(parseUiTheme(event.target.value))}>
        {UI_THEME_OPTIONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      <span className="hint">仅更改软件界面的字体和配色，不改变文章样式及导出内容。</span>
    </label>
  )
}
