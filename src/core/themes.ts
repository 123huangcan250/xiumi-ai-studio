import type { Doc, Theme, ThemeTokens } from './types'

// 微信正文不加载网络字体，只使用系统字体栈。
export const SANS = '-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif'
export const SERIF = '"Songti SC","Noto Serif SC","SimSun",serif'

export const THEMES: Theme[] = [
  {
    id: 'tsinghua-purple',
    name: '清华紫',
    description: '庄重典雅的紫色系，适合校园、学术与典礼活动',
    colors: { primary: '#660874', primarySoft: '#F4ECF6', accent: '#B8860B', text: '#2B2B2B', muted: '#8A8191', bg: '#FFFFFF', surface: '#FAF7FB', border: '#E3D3E6' },
    fontBody: SANS, fontHeading: SERIF,
    fontSize: 15, h1Size: 24, h2Size: 18, smallSize: 12,
    lineHeight: 1.85, letterSpacing: 0.5, paragraphSpacing: 18, blockSpacing: 28,
    radius: 4, imageRadius: 4,
    headingVariant: 'number', quoteVariant: 'line', cardVariant: 'border', dividerVariant: 'ornament', coverVariant: 'band',
  },
  {
    id: 'tech-blue',
    name: '科技蓝',
    description: '冷静理性的蓝色调与清晰层级，适合科技、发布会与数据报告',
    colors: { primary: '#1F5EFF', primarySoft: '#EAF1FF', accent: '#00B8D9', text: '#1D2433', muted: '#7A8499', bg: '#FFFFFF', surface: '#F5F8FF', border: '#D5E1FF' },
    fontBody: SANS, fontHeading: SANS,
    fontSize: 15, h1Size: 24, h2Size: 18, smallSize: 12,
    lineHeight: 1.8, letterSpacing: 0.3, paragraphSpacing: 16, blockSpacing: 26,
    radius: 8, imageRadius: 8,
    headingVariant: 'bar', quoteVariant: 'mark', cardVariant: 'fill', dividerVariant: 'dots', coverVariant: 'hero',
  },
  {
    id: 'warm-humanities',
    name: '人文暖色',
    description: '纸张般的暖米色与赭石，适合人物故事、文化与公益',
    colors: { primary: '#A0522D', primarySoft: '#FBF1E6', accent: '#6B8E23', text: '#3B2F2A', muted: '#9C8B7E', bg: '#FFFFFF', surface: '#FFF9F2', border: '#EBD9C6' },
    fontBody: SANS, fontHeading: SERIF,
    fontSize: 15, h1Size: 23, h2Size: 18, smallSize: 12,
    lineHeight: 1.9, letterSpacing: 0.6, paragraphSpacing: 20, blockSpacing: 30,
    radius: 2, imageRadius: 2,
    headingVariant: 'underline', quoteVariant: 'center', cardVariant: 'fill', dividerVariant: 'ornament', coverVariant: 'minimal',
  },
  {
    id: 'minimal-magazine',
    name: '极简杂志',
    description: '黑白灰与大留白，强调字重与比例，适合深度报道',
    colors: { primary: '#111111', primarySoft: '#F2F2F2', accent: '#D7263D', text: '#222222', muted: '#888888', bg: '#FFFFFF', surface: '#F7F7F7', border: '#DDDDDD' },
    fontBody: SANS, fontHeading: SERIF,
    fontSize: 15, h1Size: 26, h2Size: 19, smallSize: 12,
    lineHeight: 1.9, letterSpacing: 0.4, paragraphSpacing: 20, blockSpacing: 34,
    radius: 0, imageRadius: 0,
    headingVariant: 'underline', quoteVariant: 'line', cardVariant: 'border', dividerVariant: 'line', coverVariant: 'minimal',
  },
  {
    id: 'youth-vibe',
    name: '青春活力',
    description: '明快的珊瑚橙与薄荷绿，圆角胶囊元素，适合社团与青年活动',
    colors: { primary: '#FF6B4A', primarySoft: '#FFF0EB', accent: '#14B8A6', text: '#2D2A32', muted: '#8E8794', bg: '#FFFFFF', surface: '#FFF8F5', border: '#FFD6CB' },
    fontBody: SANS, fontHeading: SANS,
    fontSize: 15, h1Size: 24, h2Size: 18, smallSize: 12,
    lineHeight: 1.8, letterSpacing: 0.3, paragraphSpacing: 16, blockSpacing: 26,
    radius: 14, imageRadius: 12,
    headingVariant: 'pill', quoteVariant: 'mark', cardVariant: 'accent', dividerVariant: 'dots', coverVariant: 'hero',
  },
]

const customThemes = new Map<string, Theme>()

export function registerTheme(theme: Theme) {
  customThemes.set(theme.id, theme)
}

export function allThemes(): Theme[] {
  return [...THEMES, ...customThemes.values()]
}

export function getTheme(id: string): Theme {
  return customThemes.get(id) ?? THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/** 文档实际生效的主题：基础主题 + 覆盖项 */
export function resolveTheme(doc: Pick<Doc, 'themeId' | 'themeOverrides'>): Theme {
  const base = getTheme(doc.themeId)
  const o = doc.themeOverrides
  if (!o) return base
  return { ...base, ...o, colors: { ...base.colors, ...(o.colors ?? {}) } } as Theme
}

export type { ThemeTokens }
