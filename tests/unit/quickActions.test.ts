import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildVariants } from '../../src/core/layouts'
import { applyOp, applyOps, limitToSelection, selectionScope, validateOp } from '../../src/core/ops'
import { createBlock } from '../../src/core/blocks'
import { parseArticle } from '../../src/core/outline'
import { QUICK_ACTIONS, aiContext } from '../../src/core/quickActions'

const text = readFileSync(join(import.meta.dirname, '..', '..', 'samples', 'activity.txt'), 'utf8')
const images = Array.from({ length: 10 }, (_, i) => ({ src: `/media/p${i}.jpg` }))

describe('quick actions', () => {
  for (const { recipe, doc } of buildVariants(parseArticle(text), images)) {
    it(`all ops are valid and idempotent on ${recipe.id}`, () => {
      for (const a of QUICK_ACTIONS) {
        const { ops } = a.run(doc)
        for (const op of ops) expect(validateOp(doc, op).error, `${a.id}`).toBeUndefined()
        const next = applyOps(doc, ops)
        // 再执行一次不应再产生改动（分割、序号、引语去重）
        if (a.id !== 'split-long') expect(a.run(next).ops, `${a.id} second run`).toEqual([])
      }
    })
  }
  it('ai context strips images and rich text to plain text', () => {
    const ctx = aiContext(buildVariants(parseArticle(text), images)[1].doc)
    const json = JSON.stringify(ctx)
    expect(json).not.toContain('/media/')
    expect(json).not.toContain('"type":"doc"')
    expect(ctx.blocks[0]).toMatchObject({ index: 0, type: 'cover' })
  })
})

describe('ai edits limited to the selected module', () => {
  const para = (id: string, text: string) => ({ ...createBlock('paragraph'), id, props: { ...createBlock('paragraph').props, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } } }) as any
  const child = para('c1', '框里的字')
  const doc: any = {
    title: '标题',
    themeId: 'ink',
    blocks: [para('a', '第一段'), para('b', '第二段'), { ...createBlock('box'), id: 'box', props: { ...createBlock('box').props, children: [child] } }, para('d', '第四段')],
  }
  const raw = [
    { op: 'update', id: 'b', props: { content: 'x' } },
    { op: 'update', id: 'a', props: { content: 'y' } },
    { op: 'remove', id: 'd' },
    { op: 'insert', index: 1, block: { type: 'divider', props: {} } },
    { op: 'insert', index: 2, block: { type: 'divider', props: {} } },
    { op: 'insert', index: 3, block: { type: 'divider', props: {} } },
    { op: 'move', id: 'b', to: 0 },
    { op: 'setTheme', themeId: 'x' },
    { op: 'setMeta', title: '新标题' },
  ]
  it('rejects an entire mixed-scope result and never permits insert/remove', () => {
    const r = limitToSelection(doc, 'b', raw, 'strict')
    expect(r.ops).toEqual([])
    expect(limitToSelection(doc, 'b', [raw[0]], 'strict').ops).toEqual([raw[0]])
    expect(r.dropped).toEqual(raw)
  })
  it('treats a text box and its children as one scope; children insert around the box', () => {
    expect([...selectionScope(doc, 'box')!.ids]).toEqual(['box', 'c1'])
    const inChild = selectionScope(doc, 'c1')!
    expect([...inChild.ids]).toEqual(['c1'])
    expect(inChild.top).toBe(2)
    expect(limitToSelection(doc, 'c1', [{ op: 'update', id: 'c1', props: {} }, { op: 'update', id: 'box', props: {} }, { op: 'insert', index: 3 }, { op: 'insert', index: 0 }], 'strict').ops).toHaveLength(0)
  })
  it('passes everything through when nothing is selected', () => {
    expect(limitToSelection(doc, null, raw)).toEqual({ ops: raw, dropped: [] })
    expect(limitToSelection(doc, 'missing', raw)).toEqual({ ops: [], dropped: raw })
  })
  it('filters only disallowed operations when filter mode is explicitly enabled', () => {
    const before = structuredClone(raw)
    const r = limitToSelection(doc, 'b', raw, 'filter')
    expect(r.ops).toEqual([
      raw[0],
      { ...raw[3], anchor: { id: 'b', side: 'before' } },
      { ...raw[4], anchor: { id: 'b', side: 'after' } },
    ])
    expect(r.dropped).toEqual([raw[1], raw[2], ...raw.slice(5)])
    expect(raw).toEqual(before)
  })
  it('allows selected descendants but never their siblings, parent or outside blocks', () => {
    const boxed = { ...doc, blocks: [doc.blocks[0], { ...doc.blocks[2], props: { ...doc.blocks[2].props, children: [child, para('c2', '兄弟模块')] } }] }
    const ops = [
      { op: 'update', id: 'c1', props: { content: 'allowed' } },
      { op: 'remove', id: 'c2' }, { op: 'remove', id: 'box' }, { op: 'update', id: 'a', props: {} },
    ]
    expect(limitToSelection(boxed, 'box', ops, 'filter').ops).toEqual(ops.slice(0, 3))
    expect(limitToSelection(boxed, 'c1', ops, 'filter').ops).toEqual([ops[0]])
    expect(limitToSelection(boxed, 'c1', [{ op: 'insert', index: 2, block: { type: 'divider' } }], 'filter').ops[0]).toMatchObject({ anchor: { id: 'box', side: 'after' } })
  })
  it('fails closed for stale or empty selections and malformed insertion positions or anchors', () => {
    for (const id of ['missing', '']) expect(limitToSelection(doc, id, raw, 'filter')).toEqual({ ops: [], dropped: raw })
    const invalid = [null, undefined, '', '1', true, -1, 1.5, NaN, Infinity, 0, 3].map(index => ({ op: 'insert', index, block: { type: 'divider' } }))
    invalid.push(...[null, {}, { id: 'a', side: 'before' }, { id: 'b', side: 'after' }, { id: 'b', side: 'middle' }].map(anchor => ({ op: 'insert', index: 1, block: { type: 'divider' }, anchor })))
    expect(limitToSelection(doc, 'b', invalid, 'filter')).toEqual({ ops: [], dropped: invalid })
  })
  it('anchors accepted inserts to the selection when earlier operations shift its index', () => {
    const ops = limitToSelection(doc, 'b', [raw[3], raw[4]], 'filter').ops
    let next = doc
    for (const raw of ops) {
      const { op, error } = validateOp(next, raw)
      expect(error).toBeUndefined()
      next = applyOp(next, op!)
    }
    expect(next.blocks.map((b: any) => b.type)).toEqual(['paragraph', 'divider', 'paragraph', 'divider', 'box', 'paragraph'])
    expect(next.blocks[2].id).toBe('b')
    expect(next.blocks.filter((b: any) => ['a', 'box', 'd'].includes(b.id))).toEqual([doc.blocks[0], doc.blocks[2], doc.blocks[3]])
    const removed = applyOp(doc, { op: 'remove', id: 'b' })
    expect(validateOp(removed, ops[0]).error).toBeTruthy()
    expect(applyOp(removed, ops[0])).toBe(removed)
  })
  it('keeps model order for several inserts after the same selection in preview', () => {
    const inserts = ['first', 'second', 'third'].map(id => ({ op: 'insert', index: 2, anchor: { id: 'b', side: 'after' }, block: { ...createBlock('divider'), id } }))
    const next = applyOps(doc, inserts as any)
    expect(next.blocks.map(b => b.id)).toEqual(['a', 'b', 'first', 'second', 'third', 'box', 'd'])
  })
  it('ignores even malformed replacement children before coercing selected box updates', () => {
    const rawUpdate = { op: 'update', id: 'box', props: { title: 'new title', children: [{ type: 'constructor', id: 'a' }] } }
    const before = structuredClone(doc)
    const { op, error } = validateOp(doc, rawUpdate)
    expect(error).toBeUndefined()
    const next = applyOp(doc, op!)
    const box = next.blocks[2]
    if (box.type !== 'box') throw new Error('Expected selected box')
    expect(box.props.title).toBe('new title')
    expect(box.props.children).toEqual(doc.blocks[2].props.children)
    expect(next.blocks[0]).toEqual(doc.blocks[0])
    expect(doc).toEqual(before)
  })
  it('rejects malformed direct anchors instead of falling back to the numeric index', () => {
    for (const anchor of [null, {}, { id: 'missing', side: 'before' }, { id: 'c1', side: 'before' }, { id: 'b', side: 'wrong' }]) {
      expect(validateOp(doc, { op: 'insert', index: 1, block: { type: 'divider' }, anchor }).error).toBeTruthy()
    }
  })
  it('gives every inserted descendant a fresh id and cannot create aliases to outside blocks', () => {
    const rawInsert = { op: 'insert', index: 1, block: { type: 'box', id: 'a', props: { children: [para('a', '新内容'), para('c1', '新内容2')] } } }
    const before = structuredClone(rawInsert)
    const { op, error } = validateOp(doc, rawInsert)
    expect(error).toBeUndefined()
    expect(op?.op).toBe('insert')
    if (op?.op !== 'insert' || op.block.type !== 'box') throw new Error('Expected box insertion')
    const ids = [op.block.id, ...op.block.props.children.map(b => b.id)]
    expect(new Set(ids).size).toBe(3)
    expect(ids.some(id => ['a', 'b', 'box', 'c1', 'd'].includes(id))).toBe(false)
    const inserted = applyOp(doc, op)
    const changed = applyOp(inserted, { op: 'update', id: op.block.props.children[0].id, props: { content: 'changed' } })
    expect(changed.blocks[0]).toEqual(doc.blocks[0])
    expect(changed.blocks.find((b: any) => b.id === 'box')).toEqual(doc.blocks[2])
    expect(rawInsert).toEqual(before)
  })
  it('cannot smuggle arbitrary HTML or malformed modules through inserted children', () => {
    for (const child of [{ type: 'html', props: { html: '<script>bad</script>' } }, { type: 'constructor' }, { type: 'box', props: { children: [] } }, null]) {
      expect(validateOp(doc, { op: 'insert', index: 1, block: { type: 'box', props: { children: [child] } } }).error).toBeTruthy()
    }
  })
  it('sends the whole selected module and only one-line summaries of the rest', () => {
    const ctx: any = aiContext(doc, 'b')
    expect(ctx.focus).toEqual({ id: 'b', type: 'paragraph' })
    expect(ctx.blocks[1].props.content).toBe('第二段')
    expect(ctx.blocks[0]).toEqual({ index: 0, id: 'a', type: 'paragraph', summary: '第一段' })
    expect(ctx.blocks[3].summary).toBe('第四段')
    // 选中文本框里的子模块：把整个文本框交给模型，方便看到上下文
    const c2: any = aiContext(doc, 'c1')
    expect(c2.focus.id).toBe('c1')
    expect(c2.blocks[2].props.children[0].id).toBe('c1')
    // 没选中时和原来一样
    expect((aiContext(doc) as any).focus).toBeUndefined()
  })
})
