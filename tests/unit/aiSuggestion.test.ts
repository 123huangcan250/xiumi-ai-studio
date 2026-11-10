import { expect, it } from 'vitest'
import { suggestionPrompt, readSuggestion } from '../../server/aiSuggestion'

it('includes current content and limits suggestions to the selected block', () => {
  const prompt = suggestionPrompt({ title: '实践纪实', blocks: [{ id: 'p1', type: 'paragraph', text: '学习电力技术' }] }, 'p1')
  expect(prompt).toContain('学习电力技术')
  expect(prompt).toContain('p1')
  expect(prompt).toContain('仅修改选中模块')
})
it('rejects a stale selection before any model call', () => {
  expect(() => suggestionPrompt({ blocks: [] }, 'missing')).toThrow('选中的模块已不存在')
})
it('accepts only a short plain text instruction and allows no useful suggestion', () => {
  expect(readSuggestion({ suggestion: '  精简开头，突出活动主题  ' })).toEqual({ suggestion: '精简开头，突出活动主题' })
  expect(readSuggestion({ suggestion: '' })).toEqual({ suggestion: '' })
  for (const value of [undefined, { suggestion: 42 }, { suggestion: '字'.repeat(181) }, { suggestion: '建议\n另一条' }]) {
    expect(() => readSuggestion(value)).toThrow('AI 返回的输入建议格式无效')
  }
})
