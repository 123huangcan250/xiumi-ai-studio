// 文档模型：编辑器、AI、编译器共享的唯一事实来源。

/** ProseMirror / tiptap JSON 节点（富文本字段） */
export interface RichNode {
  type: string
  text?: string
  attrs?: Record<string, any>
  marks?: { type: string; attrs?: Record<string, any> }[]
  content?: RichNode[]
}
export type RichText = RichNode // { type: 'doc', content: [...] }

export interface ImageRef {
  src: string
  assetId?: string
  alt?: string
  width?: number
  height?: number
}

export type BlockType =
  | 'cover'
  | 'heading'
  | 'paragraph'
  | 'card'
  | 'quote'
  | 'imageText'
  | 'image'
  | 'gallery'
  | 'timeline'
  | 'table'
  | 'profile'
  | 'divider'
  | 'ending'
  | 'html'

export interface BlockPropsMap {
  cover: { kicker: string; title: string; subtitle: string; meta: string; image?: ImageRef; variant: 'auto' | 'hero' | 'band' | 'minimal' }
  heading: { index: string; title: string; subtitle: string; variant: 'auto' | 'number' | 'bar' | 'pill' | 'underline' }
  paragraph: { content: RichText; align: 'left' | 'justify' | 'center' }
  card: { title: string; content: RichText; variant: 'auto' | 'border' | 'fill' | 'accent' }
  quote: { text: string; source: string; variant: 'auto' | 'mark' | 'line' | 'center' }
  imageText: { image?: ImageRef; title: string; content: RichText; imagePosition: 'left' | 'right' }
  image: { image?: ImageRef; caption: string; variant: 'full' | 'framed' | 'rounded' }
  gallery: { images: ImageRef[]; columns: 1 | 2 | 3; caption: string }
  timeline: { items: { time: string; title: string; desc: string }[] }
  table: { headers: string[]; rows: string[][]; caption: string }
  profile: { image?: ImageRef; name: string; role: string; bio: string }
  divider: { variant: 'auto' | 'line' | 'dots' | 'ornament' | 'space' }
  ending: { text: string; author: string; note: string; image?: ImageRef }
  /** 原文片段：导入的公众号版块，保留原内联样式（已清洗） */
  html: { html: string; label: string }
}

export type Block<T extends BlockType = BlockType> = {
  [K in T]: { id: string; type: K; props: BlockPropsMap[K] }
}[T]

export interface Doc {
  id: string
  title: string
  author: string
  digest: string
  themeId: string
  /** 局部覆盖主题令牌（参考风格学习 / 用户微调） */
  themeOverrides?: Partial<ThemeTokens>
  cover?: ImageRef
  blocks: Block[]
  createdAt: number
  updatedAt: number
}

export interface ThemeColors {
  primary: string
  primarySoft: string
  accent: string
  text: string
  muted: string
  bg: string
  surface: string
  border: string
}

export interface ThemeTokens {
  colors: ThemeColors
  fontBody: string
  fontHeading: string
  /** px */
  fontSize: number
  h1Size: number
  h2Size: number
  smallSize: number
  lineHeight: number
  letterSpacing: number
  /** 段落之间 px */
  paragraphSpacing: number
  /** 模块之间 px */
  blockSpacing: number
  radius: number
  imageRadius: number
  headingVariant: Exclude<BlockPropsMap['heading']['variant'], 'auto'>
  quoteVariant: Exclude<BlockPropsMap['quote']['variant'], 'auto'>
  cardVariant: Exclude<BlockPropsMap['card']['variant'], 'auto'>
  dividerVariant: Exclude<BlockPropsMap['divider']['variant'], 'auto'>
  coverVariant: Exclude<BlockPropsMap['cover']['variant'], 'auto'>
}

export interface Theme extends ThemeTokens {
  id: string
  name: string
  description: string
}

/** AI 与程序化修改统一使用的操作；AI 永远不直接产出 HTML */
export type DocOp =
  | { op: 'insert'; index: number; block: Block; reason?: string }
  /** 原文片段只能按文字槽位修改：slots 为槽位 id → 新文字，props.html 由 slots 计算 */
  | { op: 'update'; id: string; props: Record<string, any>; slots?: Record<string, string>; reason?: string }
  | { op: 'remove'; id: string; reason?: string }
  | { op: 'move'; id: string; to: number; reason?: string }
  | { op: 'setTheme'; themeId: string; reason?: string }
  | { op: 'setMeta'; title?: string; digest?: string; author?: string; reason?: string }
