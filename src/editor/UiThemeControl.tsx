import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import {
  ACCENT_VAR_NAMES, accentVars, parseUiAccent, parseUiFont, parseUiTheme, readUiAccent, readUiFont, readUiTheme, resolveUiTheme,
  uiFontStack, UI_ACCENTS, UI_ACCENT_KEY, UI_FONTS, UI_FONT_KEY, UI_THEME_KEY, UI_THEME_OPTIONS,
  type UiAccent, type UiFont, type UiThemePreference,
} from './uiTheme'

type Choice = {
  preference: UiThemePreference
  select: (value: UiThemePreference) => void
  accent: UiAccent
  selectAccent: (value: UiAccent) => void
  font: UiFont
  selectFont: (value: UiFont) => void
}
const UiThemeContext = createContext<Choice | null>(null)
const store = (key: string) => window.localStorage.getItem(key)
const read = () => readUiTheme(store)
const remember = (key: string, value: string) => {
  try { window.localStorage.setItem(key, value) } catch { /* session-only fallback */ }
}

export function UiThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(read)
  const [accent, setAccent] = useState(() => readUiAccent(store))
  const [font, setFont] = useState(() => readUiFont(store))
  const [time, setTime] = useState(() => new Date())
  const theme = resolveUiTheme(preference, time)
  useLayoutEffect(() => {
    const root = document.documentElement
    if (theme === 'upstream') delete root.dataset.uiTheme
    else root.dataset.uiTheme = theme
    if (theme === 'mono-dark') root.dataset.colorMode = 'dark'
    else delete root.dataset.colorMode
  }, [theme])
  // 配色：深色界面用亮一档的主色，所以随主题重新取值
  useLayoutEffect(() => {
    const root = document.documentElement
    for (const name of ACCENT_VAR_NAMES) root.style.removeProperty(name)
    const vars = accentVars(accent, theme === 'mono-dark')
    if (!vars) {
      delete root.dataset.uiAccent
      return
    }
    root.dataset.uiAccent = accent
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value)
  }, [accent, theme])
  useLayoutEffect(() => {
    const root = document.documentElement
    if (font === 'default') {
      delete root.dataset.uiFont
      root.style.removeProperty('--ui-font')
    } else {
      root.dataset.uiFont = font
      root.style.setProperty('--ui-font', uiFontStack(font))
    }
  }, [font])
  useEffect(() => {
    const update = () => setTime(new Date())
    const sync = (event: StorageEvent) => {
      if (event.key !== null && event.key !== UI_THEME_KEY && event.key !== UI_ACCENT_KEY && event.key !== UI_FONT_KEY) return
      try {
        if (event.storageArea !== window.localStorage) return
        setPreference(read())
        setAccent(readUiAccent(store))
        setFont(readUiFont(store))
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
    remember(UI_THEME_KEY, value)
  }
  const selectAccent = (value: UiAccent) => {
    setAccent(value)
    remember(UI_ACCENT_KEY, value)
  }
  const selectFont = (value: UiFont) => {
    setFont(value)
    remember(UI_FONT_KEY, value)
  }
  return <UiThemeContext.Provider value={{ preference, select, accent, selectAccent, font, selectFont }}>{children}</UiThemeContext.Provider>
}

export function UiThemeControl() {
  const theme = useContext(UiThemeContext)
  if (!theme) return null
  return (
    <div className="ui-look">
      <label className="field">
        <span>界面主题</span>
        <select value={theme.preference} onChange={event => theme.select(parseUiTheme(event.target.value))}>
          {UI_THEME_OPTIONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      <div className="field" role="group" aria-labelledby="ui-accent-label">
        <span id="ui-accent-label">界面配色</span>
        <div className="accent-swatches">
          {UI_ACCENTS.map(a => (
            <button
              key={a.id}
              type="button"
              className={`accent-swatch${theme.accent === a.id ? ' selected' : ''}`}
              style={{ background: a.light.brand, ['--swatch' as string]: a.light.brand }}
              aria-pressed={theme.accent === a.id}
              aria-label={a.name}
              title={a.name}
              data-testid={`ui-accent-${a.id}`}
              onClick={() => theme.selectAccent(parseUiAccent(a.id))}
            />
          ))}
        </div>
        <span className="hint" data-testid="ui-accent-name">当前：{UI_ACCENTS.find(a => a.id === theme.accent)?.name}</span>
      </div>
      <label className="field">
        <span>界面字体</span>
        <select value={theme.font} data-testid="ui-font-select" onChange={event => theme.selectFont(parseUiFont(event.target.value))}>
          {UI_FONTS.map(f => <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>{f.name}</option>)}
        </select>
        <span className="hint ui-font-sample" style={{ fontFamily: uiFontStack(theme.font) }}>样例：学境 公众号排版 Aa 123</span>
      </label>
      <span className="hint">仅更改软件界面的字体和配色，不改变文章样式及导出内容。楷体、圆体依赖本机已装字体，没有时自动换成备选字体。</span>
    </div>
  )
}
