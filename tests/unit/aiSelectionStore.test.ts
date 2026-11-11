import { beforeEach, describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { applyOps } from '../../src/core/ops'
import { richToPlain, textToRich } from '../../src/core/richtext'
import { emptyDoc, useStore } from '../../src/editor/store'

const para = (id: string, text: string) => ({ ...createBlock('paragraph', { content: textToRich(text) }), id })
const update = (id: string, content: string) => ({ op: 'update', id, props: { content } })
beforeEach(() => useStore.getState().load({ ...emptyDoc(), blocks: [para('outside', 'outside'), para('selected', 'original'), para('tail', 'tail')] }))

describe('selection proposal policy', () => {
  it('keeps legacy/default client behavior atomic and update-only', () => {
    for (const options of [undefined, { policy: 'strict' as const }, { policy: 'unknown' } as any]) {
      useStore.getState().propose('mixed', [update('selected', 'new'), update('outside', 'bad')], 'selected', options)
      expect(useStore.getState().proposal?.items).toHaveLength(0)
      expect(useStore.getState().proposal?.errors).toHaveLength(2)
    }
  })
  it('keeps legal filter suggestions and reports server plus client ignores without changing the document', () => {
    const before = useStore.getState().doc
    useStore.getState().propose('mixed', [update('selected', 'new'), update('outside', 'bad')], 'selected', { policy: 'filter', ignoredOps: 2 })
    const proposal = useStore.getState().proposal!
    expect(proposal.items).toHaveLength(1)
    expect(proposal.ignoredOps).toBe(2)
    expect(proposal.errors).toHaveLength(1)
    expect(proposal.selectionPolicy).toBe('filter')
    expect(useStore.getState().doc).toBe(before)
    useStore.getState().resolveProposal('all', 'accepted')
    const after = useStore.getState().doc
    expect(richToPlain((after.blocks[1] as any).props.content)).toBe('new')
    expect(after.blocks[0]).toEqual(before.blocks[0])
    expect(after.blocks[2]).toEqual(before.blocks[2])
  })
  it('does not accept negative, fractional or unbounded server ignore counts', () => {
    for (const ignoredOps of [-1, 1.5, NaN, Infinity, '2'] as any[]) {
      useStore.getState().propose('safe', [], 'selected', { policy: 'filter', ignoredOps })
      expect(useStore.getState().proposal?.ignoredOps).toBe(0)
    }
  })
  it.each([1, 2])('keeps preview and acceptance order stable for inserts at %i, even accepted out of order', (index) => {
    const ops = ['first', 'second', 'third'].map(text => ({ op: 'insert', index, block: { type: 'paragraph', props: { content: text } } }))
    useStore.getState().propose('insert', ops, 'selected', { policy: 'filter' })
    const proposal = useStore.getState().proposal!
    const preview = applyOps(proposal.base, proposal.items.map(item => item.op))
    const texts = (doc: typeof preview) => doc.blocks.map(b => richToPlain((b as any).props.content))
    expect(texts(preview)).toEqual(index === 2 ? ['outside', 'original', 'first', 'second', 'third', 'tail'] : ['outside', 'first', 'second', 'third', 'original', 'tail'])
    for (const index of [2, 0, 1]) useStore.getState().resolveProposal(index, 'accepted')
    expect(texts(useStore.getState().doc)).toEqual(texts(preview))
  })
  it('does not follow an already accepted insert if it is moved outside the selected neighborhood', () => {
    useStore.getState().propose('insert', ['first', 'second'].map(content => ({ op: 'insert', index: 2, block: { type: 'paragraph', props: { content } } })), 'selected', { policy: 'filter' })
    useStore.getState().resolveProposal(0, 'accepted')
    const first = useStore.getState().proposal!.items[0].op
    if (first.op !== 'insert') throw new Error('Expected insertion')
    useStore.getState().moveBlockTo(first.block.id, null, 0)
    useStore.getState().resolveProposal(1, 'accepted')
    expect(useStore.getState().doc.blocks.map(b => richToPlain((b as any).props.content))).toEqual(['first', 'outside', 'original', 'second', 'tail'])
  })
  it('rejects and explains an insert whose selected anchor was removed', () => {
    useStore.getState().propose('remove then insert', [{ op: 'remove', id: 'selected' }, { op: 'insert', index: 2, block: { type: 'divider' } }], 'selected', { policy: 'filter' })
    useStore.getState().resolveProposal('all', 'accepted')
    const state = useStore.getState()
    expect(state.doc.blocks.map(b => b.id)).toEqual(['outside', 'tail'])
    expect(state.proposal!.items.map(item => item.status)).toEqual(['accepted', 'rejected'])
    expect(state.proposal!.errors.join(' ')).toContain('锚点')
  })
})
