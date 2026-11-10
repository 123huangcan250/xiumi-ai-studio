import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildVariants } from '../../src/core/layouts'
import { applyOps, limitToSelection, selectionScope, validateOp } from '../../src/core/ops'
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
    const r = limitToSelection(doc, 'b', raw)
    expect(r.ops).toEqual([])
    expect(limitToSelection(doc, 'b', [raw[0]]).ops).toEqual([raw[0]])
    expect(r.dropped).toEqual(raw)
  })
  it('treats a text box and its children as one scope; children insert around the box', () => {
    expect([...selectionScope(doc, 'box')!.ids]).toEqual(['box', 'c1'])
    const inChild = selectionScope(doc, 'c1')!
    expect([...inChild.ids]).toEqual(['c1'])
    expect(inChild.top).toBe(2)
    expect(limitToSelection(doc, 'c1', [{ op: 'update', id: 'c1', props: {} }, { op: 'update', id: 'box', props: {} }, { op: 'insert', index: 3 }, { op: 'insert', index: 0 }]).ops).toHaveLength(0)
  })
  it('passes everything through when nothing is selected', () => {
    expect(limitToSelection(doc, null, raw)).toEqual({ ops: raw, dropped: [] })
    expect(limitToSelection(doc, 'missing', raw)).toEqual({ ops: [], dropped: raw })
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
