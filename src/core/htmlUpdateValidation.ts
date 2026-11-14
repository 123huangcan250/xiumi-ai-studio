import { restructureImportedHtml } from './htmlLayout'
import { restyleImportedHtml } from './htmlTheme'
import { THEMES } from './themes'
import { extractSlots, fillSlots } from './slots'
import type { Block, DocOp } from './types'

/** HTML operations may only change validated text slots or locally generated layouts. */
export function validateHtmlUpdate(b: Block<'html'>, op: Record<string, any>): { op?: DocOp; error?: string } {
  const theme = typeof op.themeId === 'string' ? THEMES.find(t => t.id === op.themeId) : undefined
  if (op.themeId !== undefined && !theme) return { error: '未知原文主题' }
  if (op.layout !== undefined && (!theme || !['editorial', 'chapters'].includes(op.layout))) return { error: '结构重排需要有效主题和 editorial 或 chapters 布局' }
  const raw = op.slots ?? op.props?.slots ?? (theme ? {} : undefined)
  if (!raw || typeof raw !== 'object') return { error: '原文片段只能修改文字槽位（slots）' }
  const known = new Map(extractSlots(b.props.html).flatMap((s) => (s.kind === 'text' ? [[s.id, s] as const] : [])))
  const slots: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const s = known.get(k)
    if (!s || (typeof v !== 'string' && typeof v !== 'number')) continue
    slots[k] = s.tight ? [...String(v).replace(/\s*\n+\s*/g, ' ')].slice(0, s.max).join('') : String(v)
  }
  if (!Object.keys(slots).length && !theme) return { error: `修改 ${op.id} 没有有效的文字槽位` }
  let html = fillSlots(b.props.html, slots, { split: false })
  if (theme) html = restyleImportedHtml(html, theme)
  let reason = op.reason
  if (op.layout && theme) {
    const result = restructureImportedHtml(html, op.layout, theme)
    if (result.error || !result.html) return { error: result.error ?? '结构重排失败' }
    html = result.html
    reason = `${reason ?? '重新组织文章结构'}；${result.preserved ? `${result.preserved} 个复杂区块保留原结构，仅重排其余内容` : '已按原阅读顺序重组段落，保留全部文字、图片与链接'}`
  }
  return { op: { op: 'update', id: op.id, props: { html }, slots, ...(theme && { themeId: theme.id }), ...(op.layout && { layout: op.layout }), reason } }

}
