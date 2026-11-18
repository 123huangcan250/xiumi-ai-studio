export type UiThemePreference = 'upstream' | 'mono-light' | 'mono-dark' | 'mono-auto'
export type ResolvedUiTheme = Exclude<UiThemePreference, 'mono-auto'>

export const UI_THEME_KEY = 'xiumi-ui-theme'
export const UI_THEME_OPTIONS: ReadonlyArray<readonly [UiThemePreference, string]> = [
  ['upstream', '上游默认'],
  ['mono-light', '黑白 · 浅色'],
  ['mono-dark', '黑白 · 深色'],
  ['mono-auto', '黑白 · 本地昼夜'],
]

export function parseUiTheme(value: unknown): UiThemePreference {
  return value === 'mono-light' || value === 'mono-dark' || value === 'mono-auto' ? value : 'upstream'
}

export function readUiTheme(read: (key: string) => string | null): UiThemePreference {
  try {
    const value = read(UI_THEME_KEY)
    if (value !== null) return parseUiTheme(value)
    const legacy = read('xiumi-color-mode')
    return legacy === 'dark' ? 'mono-dark' : legacy === 'auto' ? 'mono-auto' : 'upstream'
  } catch {
    return 'upstream'
  }
}

export function resolveUiTheme(preference: UiThemePreference, now = new Date()): ResolvedUiTheme {
  if (preference !== 'mono-auto') return preference
  const hour = now.getHours()
  return hour >= 7 && hour < 19 ? 'mono-light' : 'mono-dark'
}
