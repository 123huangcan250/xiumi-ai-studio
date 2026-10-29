// 无需大模型的规则化“AI”动作：同样产出 ops，走同一套差异审阅流程。
import { createBlock } from './blocks'
import { richToPlain, textToRich } from './richtext'
import { extractSlots } from './slots'
import type { Block, Doc, DocOp } from './types'

export interface QuickAction {
  id: string
  label: string
  run: (doc: Doc) => { summary: string; ops: DocOp[] }
}

const sentences = (s: string) => s.match(/[^。！？!?]+[。！？!?”"]*/g) ?? [s]

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'split-long',
    label: '拆分长段落',
    run(doc) {
      const ops: DocOp[] = []
      let offset = 0
      doc.blocks.forEach((b, i) => {
        if (b.type !== 'paragraph') return
        const text = richToPlain(b.props.content)
        if (text.length < 200 || text.includes('\n')) return
        const parts = sentences(text)
        const half = Math.ceil(parts.length / 2)
        ops.push({ op: 'update', id: b.id, props: { content: textToRich(parts.slice(0, half).join('')) }, reason: `段落 ${text.length} 字，手机上阅读压力大` })
        ops.push({ op: 'insert', index: i + 1 + offset, block: createBlock('paragraph', { content: textToRich(parts.slice(half).join('')) }), reason: '拆出的后半段' })
        offset++
      })
      return { summary: ops.length ? `拆分 ${ops.length / 2} 个超过 200 字的段落` : '没有需要拆分的长段落', ops }
    },
  },
  {
    id: 'pull-quotes',
    label: '提炼金句为引言',
    run(doc) {
      const ops: DocOp[] = []
      const existing = new Set(doc.blocks.filter((b) => b.type === 'quote').map((b) => (b as Block<'quote'>).props.text))
      let offset = 0
      doc.blocks.forEach((b, i) => {
        // 全文引言最多 4 处，避免重复点击不断堆叠
        if (b.type !== 'paragraph' || existing.size + ops.length >= 4) return
        const m = richToPlain(b.props.content).match(/[“"「]([^”"」]{12,60})[”"」]/)
        if (!m || existing.has(m[1])) return
        ops.push({ op: 'insert', index: i + 1 + offset, block: createBlock('quote', { text: m[1], source: '', variant: 'auto' }), reason: '段落中的直接引语适合单独突出' })
        offset++
      })
      return { summary: ops.length ? `提炼 ${ops.length} 处引语` : '没有找到合适的引语', ops }
    },
  },
  {
    id: 'section-dividers',
    label: '章节间加分割',
    run(doc) {
      const ops: DocOp[] = []
      let offset = 0
      let seenHeading = false
      doc.blocks.forEach((b, i) => {
        if (b.type !== 'heading') return
        const prev = doc.blocks[i - 1]
        if (seenHeading && prev?.type !== 'divider') {
          ops.push({ op: 'insert', index: i + offset, block: createBlock('divider', { variant: 'auto' }), reason: '分隔章节，增加呼吸感' })
          offset++
        }
        seenHeading = true
      })
      return { summary: ops.length ? `在 ${ops.length} 个章节前加入分割装饰` : '章节之间已有分割', ops }
    },
  },
  {
    id: 'renumber',
    label: '重排章节序号',
    run(doc) {
      const ops: DocOp[] = []
      let n = 0
      for (const b of doc.blocks) {
        if (b.type !== 'heading' || !b.props.index) continue
        const index = String(++n).padStart(2, '0')
        if (b.props.index !== index) ops.push({ op: 'update', id: b.id, props: { index }, reason: '序号与顺序不一致' })
      }
      return { summary: ops.length ? `修正 ${ops.length} 个章节序号` : '章节序号已连续', ops }
    },
  },
]

/** 发送给大模型的精简文档上下文（富文本转纯文本，图片只给数量） */
export function aiContext(doc: Doc) {
  return {
    title: doc.title,
    themeId: doc.themeId,
    blocks: doc.blocks.map((b, index) => {
      // 原文片段只给文字槽位，AI 按槽位修改
      if (b.type === 'html') {
        const slots = extractSlots(b.props.html).flatMap((s) => (s.kind === 'text' ? [{ id: s.id, role: s.role, text: s.text.slice(0, 300), ...(s.tight && { max: s.max }) }] : []))
        return { index, id: b.id, type: b.type, props: { label: b.props.label, slots } }
      }
      const p: any = { ...b.props }
      for (const k of Object.keys(p)) {
        if (k === 'content') p[k] = richToPlain(p[k])
        else if (k === 'image') p[k] = p[k] ? '[图片]' : undefined
        else if (k === 'images') p[k] = `[${p[k].length} 张图片]`
      }
      return { index, id: b.id, type: b.type, props: p }
    }),
  }
}
