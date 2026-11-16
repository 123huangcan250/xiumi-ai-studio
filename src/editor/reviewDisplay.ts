import { compileBlock, compileDoc, compileReplay } from '../core/compiler'
import { replayFinalTimes } from '../core/replay'
import { boxTheme } from '../core/kit'
import { describeOp } from '../core/ops'
import { resolveTheme } from '../core/themes'
import { findBlock } from '../core/tree'
import type { Block, Doc, DocOp } from '../core/types'
import { resolveProposalItems } from './proposalSafety'
import type { Proposal } from './store'

/** Same automatic final-time view as the upstream canvas, confined to display copies. */
export interface ReplayFrame { token: string; times: number[] }
function displayBlock(block: Block, frames: ReplayFrame[]): Block {
  if (block.type === 'box') return { ...block, props: { ...block.props, children: block.props.children.map(child => displayBlock(child, frames)) } }
  if (block.type === 'html') {
    const parsed = new DOMParser().parseFromString(block.props.html, 'text/html')
    parsed.querySelectorAll('[data-review-freeze]').forEach(node => node.removeAttribute('data-review-freeze'))
    return { ...block, props: { ...block.props, html: parsed.body.innerHTML } }
  }
  if (block.type !== 'replay') return block
  const shown: Block<'replay'> = { ...block, props: { ...block.props, playback: { ...block.props.playback, trigger: 'auto', loop: undefined } } }
  const times = replayFinalTimes(shown.props)
  if (times.some(time => !Number.isFinite(time) || time < 0 || time > 86400)) throw new Error('Invalid static replay duration')
  const token = crypto.randomUUID()
  frames.push({ token, times })
  return { id: block.id, type: 'html', props: { label: '编辑回放静态成稿', html: `<section data-review-freeze="${token}">${compileReplay(shown).html}</section>` } }
}
const displayDoc = (doc: Doc, frames: ReplayFrame[]): Doc => ({ ...doc, blocks: doc.blocks.map(block => displayBlock(block, frames)) })

export interface ReviewItem {
  index: number
  kind: DocOp['op']
  title: string
  reason?: string
  targetId?: string
  attachmentId?: string
  beforeId?: string
  position?: number
  html: string
  replayFrames: ReplayFrame[]
  beforeReplayFrames: ReplayFrame[]
  beforeHtml?: string
  beforeMeta?: string
  original?: Doc
  error?: string
  projected: Doc
}
/** One acceptance projection per item. The inserted identity comes from that projection,
 * never from a second validation. The store remains the only authority that applies it. */
export function reviewItems(proposal: Proposal, doc: Doc): ReviewItem[] {
  const targets = new Set(proposal.items.filter(item => item.status === 'pending').flatMap(item => 'id' in item.op ? [item.op.id] : []))
  return proposal.items.flatMap((item, index) => {
    if (item.status !== 'pending') return []
    const result = resolveProposalItems(proposal, doc, index, 'accepted')
    const resolved = result.proposal.items[index]
    const op = resolved.op
    let error = resolved.status !== 'accepted' ? result.proposal.errors.at(-1) ?? '建议已过期' : undefined
    const targetId = 'id' in op ? op.id : undefined
    const theme = resolveTheme(result.doc)
    const replayFrames: ReplayFrame[] = [], beforeReplayFrames: ReplayFrame[] = []
    let beforeHtml: string | undefined
    let html = '', beforeId: string | undefined, position: number | undefined
    try {
    if (!error) {
      if (op.op === 'insert') {
        const block = findBlock(result.doc.blocks, op.block.id)?.block
        if (block) html = compileBlock(displayBlock(block, replayFrames), theme)
        const at = result.doc.blocks.findIndex(b => b.id === op.block.id)
        beforeId = result.doc.blocks.slice(at + 1).find(b => doc.blocks.some(original => original.id === b.id))?.id
        position = at + 1
      } else if (op.op === 'update' || op.op === 'move') {
        const block = findBlock(result.doc.blocks, op.id)?.block
        if (block) html = compileBlock(displayBlock(block, replayFrames), findBlock(result.doc.blocks, op.id)?.parent ? boxTheme(theme) : theme, { inBox: !!findBlock(result.doc.blocks, op.id)?.parent })
        if (op.op === 'move') position = result.doc.blocks.findIndex(b => b.id === op.id) + 1
      } else if (op.op === 'setTheme') { html = compileDoc(displayDoc(result.doc, replayFrames)).html; beforeHtml = compileDoc(displayDoc(doc, beforeReplayFrames)).html }
    }
    } catch { error = '建议无法安全预览，请重新生成'; html = ''; beforeHtml = undefined }
    // Missing/deleted targets are presented at the article end, never silently hidden.
    return [{ index, kind: op.op, title: describeOp(doc, op).title, reason: op.reason,
      targetId: targetId && findBlock(doc.blocks, targetId) ? targetId : undefined,
      attachmentId: targetId ? (() => {
        const parent = findBlock(doc.blocks, targetId)?.parent
        return parent && targets.has(parent.id) ? parent.id : targetId
      })() : undefined,
      replayFrames, beforeReplayFrames, beforeHtml,
      beforeMeta: op.op === 'setMeta' ? `标题：${doc.title}\n作者：${doc.author ?? ''}\n摘要：${doc.digest ?? ''}` : undefined,
      original: doc,
      beforeId: op.op === 'setMeta' || op.op === 'setTheme' ? doc.blocks[0]?.id : beforeId, position, html, error, projected: result.doc }]
  })
}
