import { applyOp, orderInsert, validateOp } from '../core/ops'
import { skeleton, slotRawTexts } from '../core/slots'
import type { Block, Doc, DocOp } from '../core/types'
import type { Proposal, ProposalItem } from './store'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const changed = '对应内容已变化，请重新生成修改建议'
const record = (value: any): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value)
/** Arrays (including rich text) are atomic: never merge by positional index. */
function delta(before: any, suggested: any, current: any): { value: any; conflict: boolean } {
  if (same(before, suggested)) return { value: current, conflict: false }
  if (record(before) && record(suggested) && record(current)) {
    const value = { ...current }
    for (const key of new Set([...Object.keys(before), ...Object.keys(suggested)])) {
      const next = delta(before[key], suggested[key], current[key])
      if (next.conflict) return next
      if (next.value === undefined) delete value[key]
      else value[key] = next.value
    }
    return { value, conflict: false }
  }
  return { value: suggested, conflict: !same(before, current) }
}
function uniqueBlock(doc: Doc, id: string): Block | undefined {
  const found: Block[] = []
  const visit = (blocks: Block[]) => blocks.forEach(block => {
    if (block.id === id) found.push(block)
    if (block.type === 'box') visit(block.props.children)
  })
  visit(doc.blocks)
  return found.length === 1 ? found[0] : undefined
}
/** Pure guard/rebase. Anchored inserts remain owned by upstream validateOp/orderInsert. */
export function prepareProposalItem(proposal: Proposal, doc: Doc, index: number): { op?: DocOp; error?: string } {
  const item = proposal.items[index]
  if (!Number.isInteger(index) || !item || item.status !== 'pending') return { error: '此建议已处理或不存在' }
  if (doc.id !== proposal.base.id) return { error: '当前文稿已切换' }
  const original = item.op
  let raw = original
  if (original.op === 'update' || original.op === 'remove' || original.op === 'move') {
    const before = uniqueBlock(proposal.base, original.id), current = uniqueBlock(doc, original.id)
    if (!before || !current || before.type !== current.type) return { error: '对应模块已删除、更换或标识重复' }
    if (original.op !== 'update') {
      if (!same(before, current)) return { error: changed }
    } else if (before.type === 'html' && current.type === 'html') {
      // skeleton preserves styling/color and topology. Slot text IDs must still match.
      const a = slotRawTexts(before.props.html), b = slotRawTexts(current.props.html)
      if (skeleton(before.props.html) !== skeleton(current.props.html) || !same(Object.keys(a), Object.keys(b)) ||
        Object.keys(original.slots ?? {}).some(key => !(key in a) || a[key] !== b[key])) return { error: changed }
    } else {
      const props: Record<string, any> = {}
      for (const key of Object.keys(original.props)) {
        const result = delta((before.props as any)[key], original.props[key], (current.props as any)[key])
        if (result.conflict) return { error: changed }
        props[key] = result.value
      }
      raw = { ...original, props }
    }
  }
  if (original.op === 'setMeta') {
    for (const key of ['title', 'digest', 'author'] as const) if (original[key] !== undefined && !same(proposal.base[key], doc[key])) return { error: changed }
  }
  if (original.op === 'setTheme' && (!same(proposal.base.themeId, doc.themeId) || !same(proposal.base.themeOverrides, doc.themeOverrides))) return { error: changed }
  if (original.op === 'move' || (original.op === 'insert' && !original.anchor)) {
    // Replay only our own successful structure changes, in actual acceptance order.
    // External reorder/removal must not be mistaken for a preceding accepted move.
    const expected = (proposal.appliedStructure ?? []).reduce((next, op) => applyOp(next, op), proposal.base)
    if (!same(expected.blocks.map(b => b.id), doc.blocks.map(b => b.id))) return { error: '文稿顺序已变化，请重新生成建议' }
  }
  return validateOp(doc, raw)
}

/** Read-only projection shared by preview and commit. No store mutation or cached HTML application. */
export function resolveProposalItems(proposal: Proposal, doc: Doc, index: number | 'all', status: 'accepted' | 'rejected') {
  const items: ProposalItem[] = proposal.items.map(item => ({ ...item }))
  const errors = [...proposal.errors]
  const appliedStructure = [...(proposal.appliedStructure ?? [])]
  let next = doc
  const targets = index === 'all' ? items.map((_, i) => i) : [index]
  for (const i of targets) {
    if (!items[i] || items[i].status !== 'pending') continue
    if (status === 'accepted') {
      const result = prepareProposalItem({ ...proposal, items, appliedStructure }, next, i)
      if (!result.op) {
        items[i] = { ...items[i], status: 'rejected' }; errors.push(result.error ?? changed); continue
      }
      const accepted = (list: ProposalItem[]) => list.filter(item => item.status === 'accepted').map(item => item.op)
      const op = orderInsert(next, result.op, accepted(items.slice(0, i)), accepted(items.slice(i + 1)))
      next = applyOp(next, op)
      if (op.op === 'insert' || op.op === 'remove' || op.op === 'move') appliedStructure.push(op)
      // Keep the original anchor, but retain the actual inserted identity generated by validation.
      items[i] = { ...items[i], op: result.op }
    }
    items[i] = { ...items[i], status }
  }
  return { doc: next, proposal: { ...proposal, items, errors, appliedStructure } }
}
export const previewProposal = (proposal: Proposal, doc: Doc) => resolveProposalItems(proposal, doc, 'all', 'accepted').doc
