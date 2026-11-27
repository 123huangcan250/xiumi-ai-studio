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

// ---------- 界面配色与界面字体（只改软件界面，不碰文章和导出内容） ----------

export type UiAccent = 'default' | 'sakura' | 'rose' | 'amber' | 'matcha' | 'teal' | 'sky' | 'lavender'
export type UiFont = 'default' | 'sans' | 'serif' | 'kai' | 'round' | 'mono'

export const UI_ACCENT_KEY = 'xiumi-ui-accent'
export const UI_FONT_KEY = 'xiumi-ui-font'

interface AccentSpec {
  id: UiAccent
  name: string
  /** 浅色界面：主色（白字按钮、链接）、淡底、按下/悬停的深一档、页面底色的淡染 */
  light: { brand: string; soft: string; hover: string; bg: string }
  /** 深色界面：主色（深字按钮、链接）、淡底、悬停的亮一档 */
  dark: { brand: string; soft: string; hover: string }
}

/** 第一项是上游默认配色，不写任何覆盖 */
export const UI_ACCENTS: ReadonlyArray<AccentSpec> = [
  { id: 'default', name: '默认紫', light: { brand: '#5b4bdb', soft: '#efedff', hover: '#4a3bc7', bg: '#f2f3f5' }, dark: { brand: '#b5acff', soft: '#2a2740', hover: '#cbc4ff' } },
  { id: 'sakura', name: 'Sakura 樱花粉', light: { brand: '#b83a64', soft: '#fdeef3', hover: '#a02f55', bg: '#fbf1f4' }, dark: { brand: '#f4a3bd', soft: '#3b2530', hover: '#f8bfd1' } },
  { id: 'rose', name: '玫瑰红', light: { brand: '#b8324a', soft: '#fdecef', hover: '#9d283d', bg: '#faf1f2' }, dark: { brand: '#f29aa8', soft: '#3b2227', hover: '#f7b6c0' } },
  { id: 'amber', name: '琥珀橙', light: { brand: '#a8530a', soft: '#fef3e2', hover: '#8d4407', bg: '#faf5ee' }, dark: { brand: '#f5b25a', soft: '#3a2d1a', hover: '#f8c681' } },
  { id: 'matcha', name: '抹茶绿', light: { brand: '#4a7a0c', soft: '#eef6e0', hover: '#3c6309', bg: '#f3f6ee' }, dark: { brand: '#a6d36a', soft: '#26301a', hover: '#bde08c' } },
  { id: 'teal', name: '薄荷青', light: { brand: '#0f766e', soft: '#e0f4f1', hover: '#0c5f59', bg: '#eff6f5' }, dark: { brand: '#5fd1c4', soft: '#1a2f2c', hover: '#8be0d6' } },
  { id: 'sky', name: '天青蓝', light: { brand: '#1c6bb3', soft: '#e6f1fb', hover: '#175a97', bg: '#eff4f9' }, dark: { brand: '#7cb8f0', soft: '#1c2a38', hover: '#a2cdf5' } },
  { id: 'lavender', name: '薰衣草', light: { brand: '#7048c8', soft: '#f0ebfc', hover: '#5c39ac', bg: '#f5f2fa' }, dark: { brand: '#b9a2f2', soft: '#2b2438', hover: '#cdbcf6' } },
]

/** 界面字体；不在本机的字体由后面的备选自动补上 */
export const UI_FONTS: ReadonlyArray<{ id: UiFont; name: string; stack: string }> = [
  { id: 'default', name: '系统默认', stack: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif" },
  { id: 'sans', name: '思源黑体', stack: "'Noto Sans SC Variable', 'Microsoft YaHei', 'PingFang SC', sans-serif" },
  { id: 'serif', name: '思源宋体', stack: "'Noto Serif SC Variable', 'Songti SC', 'SimSun', serif" },
  { id: 'kai', name: '楷体', stack: "'KaiTi', '楷体', 'Kaiti SC', 'STKaiti', 'Noto Serif SC Variable', serif" },
  { id: 'round', name: '圆体', stack: "'YouYuan', '幼圆', 'Yuanti SC', 'Noto Sans SC Variable', sans-serif" },
  { id: 'mono', name: '等宽', stack: "'Cascadia Mono', Consolas, 'Sarasa Mono SC', 'Microsoft YaHei', monospace" },
]

export function parseUiAccent(value: unknown): UiAccent {
  return UI_ACCENTS.some(a => a.id === value) ? (value as UiAccent) : 'default'
}
export function parseUiFont(value: unknown): UiFont {
  return UI_FONTS.some(f => f.id === value) ? (value as UiFont) : 'default'
}
function readSaved<T>(read: (key: string) => string | null, key: string, parse: (v: unknown) => T, fallback: T): T {
  try {
    const value = read(key)
    return value === null ? fallback : parse(value)
  } catch {
    return fallback
  }
}
export const readUiAccent = (read: (key: string) => string | null) => readSaved(read, UI_ACCENT_KEY, parseUiAccent, 'default' as UiAccent)
export const readUiFont = (read: (key: string) => string | null) => readSaved(read, UI_FONT_KEY, parseUiFont, 'default' as UiFont)

/** 写到根元素上的配色变量；默认配色返回 null（不覆盖任何东西） */
export function accentVars(accent: UiAccent, dark: boolean): Record<string, string> | null {
  const spec = UI_ACCENTS.find(a => a.id === accent)
  if (!spec || spec.id === 'default') return null
  const c = dark ? spec.dark : spec.light
  return {
    '--ui-acc': c.brand,
    '--ui-acc-soft': c.soft,
    '--ui-acc-hover': c.hover,
    '--ui-acc-on': dark ? '#181816' : '#ffffff',
    ...(dark ? {} : { '--ui-acc-bg': spec.light.bg }),
  }
}
export const ACCENT_VAR_NAMES = ['--ui-acc', '--ui-acc-soft', '--ui-acc-hover', '--ui-acc-on', '--ui-acc-bg'] as const

export const uiFontStack = (font: UiFont) => (UI_FONTS.find(f => f.id === font) ?? UI_FONTS[0]!).stack

export function resolveUiTheme(preference: UiThemePreference, now = new Date()): ResolvedUiTheme {
  if (preference !== 'mono-auto') return preference
  const hour = now.getHours()
  return hour >= 7 && hour < 19 ? 'mono-light' : 'mono-dark'
}
