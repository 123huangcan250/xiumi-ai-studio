import { describe, expect, it } from 'vitest'
import { editPrompt, scopeEditResult } from '../../server/aiEdit'
const context = { blocks: [{ id: 'p1', type: 'paragraph', text: 'first' }, { id: 'p2', type: 'paragraph', text: 'second' }] }
describe('selected AI edits', () => {
  it('identifies the selected block explicitly in the prompt', () => {
    expect(editPrompt(context, '润色这段', 'p2')).toContain('仅修改选中模块 p2')
  })
  it('rejects stale selection rather than silently editing the full document', () => {
    expect(() => editPrompt(context, '润色', 'missing')).toThrow('选中的模块已不存在')
  })
  it('rejects whole-document and other-block operations in selection mode', () => {
    expect(() => scopeEditResult({ ops: [{ op: 'update', id: 'p1' }] }, 'p2')).toThrow('超出选中模块范围')
    expect(() => scopeEditResult({ ops: [{ op: 'setTheme', themeId: 'new' }] }, 'p2')).toThrow('超出选中模块范围')
  })
  it('preserves selected updates and allows full-document mode explicitly', () => {
    const result = { ops: [{ op: 'update', id: 'p2', props: { content: 'new' } }] }
    expect(scopeEditResult(result, 'p2')).toEqual(result)
    expect(scopeEditResult({ ops: [{ op: 'setTheme' }] })).toEqual({ ops: [{ op: 'setTheme' }] })
  })
})
