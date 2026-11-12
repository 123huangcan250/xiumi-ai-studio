import { afterEach, describe, expect, it, vi } from 'vitest'
import { editPrompt, prepareEdit, resolveEditSelection, scopeEditResult, selectionPolicy } from '../../server/aiEdit'
const context = { blocks: [{ id: 'p1', type: 'paragraph', text: 'first' }, { id: 'p2', type: 'paragraph', text: 'second' }] }
describe('selected AI edits', () => {
  it('identifies the selected block explicitly in the prompt', () => {
    expect(editPrompt(context, '润色这段', 'p2')).toContain('仅修改选中模块 p2')
  })
  it('rejects stale selection rather than silently editing the full document', () => {
    expect(() => editPrompt(context, '润色', 'missing')).toThrow('选中的模块已不存在')
  })
  it('rejects whole-document and other-block operations in selection mode', () => {
    expect(() => scopeEditResult({ ops: [{ op: 'update', id: 'p1' }] }, 'p2', context, 'strict')).toThrow('超出选中模块范围')
    expect(() => scopeEditResult({ ops: [{ op: 'setTheme', themeId: 'new' }] }, 'p2', context, 'strict')).toThrow('超出选中模块范围')
  })
  it('preserves selected updates and allows full-document mode explicitly', () => {
    const result = { ops: [{ op: 'update', id: 'p2', props: { content: 'new' } }] }
    expect(scopeEditResult(result, 'p2', context, 'strict')).toMatchObject({ ...result, selectionPolicy: 'strict', ignoredOps: 0 })
    expect(scopeEditResult({ ops: [{ op: 'setTheme' }] }, undefined, undefined, 'strict')).toMatchObject({ ops: [{ op: 'setTheme' }], selectionPolicy: 'strict', ignoredOps: 0 })
  })
})


describe('server-owned selection policy', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('uses filter by default and fails closed for invalid explicit values', () => {
    for (const value of ['strict', 'STRICT', 'Filter', 'anything']) {
      vi.stubEnv('AI_SELECTION_POLICY', value)
      expect(selectionPolicy()).toBe('strict')
    }
    vi.stubEnv('AI_SELECTION_POLICY', 'filter')
    expect(selectionPolicy()).toBe('filter')
  })
  it('preserves explicit strict atomic rejection even when the model claims filter mode', () => {
    expect(() => scopeEditResult({ selectionPolicy: 'filter', ops: [
      { op: 'update', id: 'p2', props: { content: 'allowed' } },
      { op: 'update', id: 'p1', props: { content: 'outside' } },
    ] }, 'p2', context, 'strict')).toThrow('超出选中模块范围')
  })
  it('filters mixed results without throwing and reports the actual ignored count', () => {
    const result = { summary: 'mixed', ignoredOps: 999, selectionPolicy: 'strict', ops: [
      { op: 'update', id: 'p2', props: { content: 'allowed' } },
      { op: 'update', id: 'p1', props: { content: 'outside' } },
      { op: 'setTheme', themeId: 'outside' },
    ] }
    const before = structuredClone(result)
    expect(scopeEditResult(result, 'p2', context, 'filter')).toEqual({
      summary: 'mixed', selectionPolicy: 'filter', ignoredOps: 2, ops: [result.ops[0]],
    })
    expect(result).toEqual(before)
  })
  it('returns an empty review with a count when every filtered operation is outside scope', () => {
    expect(scopeEditResult({ ops: [{ op: 'remove', id: 'p1' }] }, 'p2', context, 'filter')).toMatchObject({
      ops: [], ignoredOps: 1, selectionPolicy: 'filter',
    })
  })
  it('supports a selected box and its descendants despite summary-only neighboring boxes', () => {
    const nested = { blocks: [
      { id: 'outside-box', type: 'box', summary: 'background' },
      { id: 'box', type: 'box', props: { children: [{ id: 'child', type: 'paragraph', props: {} }] } },
    ] }
    const ops = [{ op: 'update', id: 'child', props: { content: 'new' } }, { op: 'remove', id: 'box' }]
    expect(scopeEditResult({ ops }, 'box', nested, 'filter')).toMatchObject({ ops, ignoredOps: 0 })
    expect(() => scopeEditResult({ ops }, 'box', nested, 'strict')).toThrow('超出选中模块范围')
    expect(editPrompt(nested, '精简', 'box', 'filter')).toContain('子模块')
    expect(editPrompt(nested, '精简', 'box', 'filter')).toContain('紧前或紧后')
  })
  it('rejects malformed results rather than treating them as an empty successful edit', () => {
    for (const policy of ['strict', 'filter'] as const) {
      for (const result of [null, {}, { ops: 'bad' }]) {
        expect(() => scopeEditResult(result, 'p2', context, policy)).toThrow()
      }
    }
  })
})

describe('selection resolution', () => {
  it('uses an explicit selected id or context focus, and allows document mode without either', () => {
    expect(resolveEditSelection(context, 'p2')).toBe('p2')
    expect(resolveEditSelection({ ...context, focus: { id: 'p2' } })).toBe('p2')
    expect(resolveEditSelection(context)).toBeUndefined()
  })
  it('never treats invalid or conflicting focus as full-document mode', () => {
    for (const focus of [null, {}, { id: '' }, { id: 42 }, { id: 'missing' }]) {
      expect(() => editPrompt({ ...context, focus }, '修改')).toThrow()
      expect(() => scopeEditResult({ ops: [] }, undefined, { ...context, focus }, 'filter')).toThrow()
    }
    for (const id of [null, '', 42, 'missing']) {
      expect(() => resolveEditSelection(context, id)).toThrow()
    }
    expect(() => resolveEditSelection({ ...context, focus: { id: 'p1' } }, 'p2')).toThrow()
    expect(() => scopeEditResult({ ops: [] }, 'missing', context, 'filter')).toThrow()
  })
})

describe('review regressions', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('defaults the upstream server to filtering while preserving explicit strict', () => {
    vi.stubEnv('AI_SELECTION_POLICY', undefined)
    expect(selectionPolicy()).toBe('filter')
    vi.stubEnv('AI_SELECTION_POLICY', 'strict')
    expect(selectionPolicy()).toBe('strict')
  })
  it('allows selected container descendants in strict mode but rejects a mixed batch atomically', () => {
    const nested = { blocks: [{ id: 'box', type: 'box', props: { children: [{ id: 'child', type: 'paragraph' }] } }, { id: 'outside', type: 'paragraph' }] }
    const update = { op: 'update', id: 'child', props: { content: 'new' } }
    expect(scopeEditResult({ ops: [update] }, 'box', nested, 'strict').ops).toEqual([update])
    expect(editPrompt(nested, 'edit', 'box', 'strict')).toContain('子模块')
    expect(() => scopeEditResult({ ops: [update, { op: 'update', id: 'outside' }] }, 'box', nested, 'strict')).toThrow('超出选中模块范围')
    expect(() => scopeEditResult({ ops: [update, { op: 'insert', index: 1 }] }, 'box', nested, 'strict')).toThrow('超出选中模块范围')
  })
})

it('prepares an edit once and reuses its validated selection for prompt and result', () => {
  let reads = 0
  const ctx = { ...context, get focus() { reads++; return { id: 'p2' } } }
  const edit = prepareEdit(ctx, 'p2', 'strict')
  const afterPrepare = reads
  expect(edit.prompt('polish')).toContain('仅修改选中模块 p2')
  expect(edit.result({ ops: [{ op: 'update', id: 'p2' }] }).ops).toHaveLength(1)
  // Serialization may access focus once; boundary resolution must not run again.
  expect(reads).toBe(afterPrepare + 1)
})
