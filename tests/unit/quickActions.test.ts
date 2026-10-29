import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildVariants } from '../../src/core/layouts'
import { applyOps, validateOp } from '../../src/core/ops'
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
