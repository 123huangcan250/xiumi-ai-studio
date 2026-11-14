import { describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { validateOp } from '../../src/core/ops'
import type { Doc } from '../../src/core/types'

const replay = createBlock('replay')
const paragraph = createBlock('paragraph')
const doc: Doc = { id: 'replay-merge', title: 'Replay compatibility', author: '', digest: '', themeId: 'tech-blue', blocks: [paragraph, replay], createdAt: 0, updatedAt: 0 }

describe('upstream replay and AI identity-boundary integration', () => {
  it('preserves the upstream prohibition on AI-inserted replay, including nested payloads', () => {
    expect(validateOp(doc, { op: 'insert', block: replay }).error).toBeTruthy()
    expect(validateOp(doc, { op: 'insert', block: { type: 'box', props: { children: [replay] } } }).error).toBeTruthy()
  })
  it('rejects AI replay updates without modifying its original structure', () => {
    const before = JSON.stringify(replay)
    expect(validateOp(doc, { op: 'update', id: replay.id, props: { scenes: [] } }).error).toBeTruthy()
    expect(JSON.stringify(replay)).toBe(before)
  })
  it('retains anchored paragraph insert validation and creates a fresh identity', () => {
    const result = validateOp(doc, { op: 'insert', block: paragraph, anchor: { id: paragraph.id, side: 'after' } })
    expect(result.error).toBeUndefined()
    expect(result.op).toMatchObject({ op: 'insert', index: 1, anchor: { id: paragraph.id, side: 'after' } })
    if (result.op?.op !== 'insert') throw new Error('Expected a valid insertion')
    expect(result.op.block.id).not.toBe(paragraph.id)
  })
})
