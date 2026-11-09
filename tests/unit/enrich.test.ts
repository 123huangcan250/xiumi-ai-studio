import { describe, expect, it } from 'vitest'
import { checkEnriched, enrichChanges, enrichedText, enrichPhotos, keepSentences } from '../../src/core/enrich'

const TEXT = `# 走进慕尼黑

副标题：电机系赴德实践第一站

## 工厂参观

上午，支队来到一家工厂的装配车间。【待补充：工厂名称】

## 实验室交流

下午在实验室听了报告，大家提了很多问题。`

describe('enrich copy with photo notes', () => {
  const images = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
  const notes = { a: '西门子安贝格工厂的装配线', b: '', c: ' 李老师讲解变流器 ', d: '实验室合影' }
  const groups = [{ id: 'g1', photos: ['c', 'd'] }]
  const anchors = { a: '来到一家工厂的装配车间', g1: '下午在实验室听了报告', b: '不存在的句子' }

  it('lists only described photos with their number, group and position', () => {
    expect(enrichPhotos({ images, notes, groups, anchors })).toEqual([
      { no: 1, note: '西门子安贝格工厂的装配线', after: '来到一家工厂的装配车间' },
      { no: 3, note: '李老师讲解变流器', group: 'A', after: '下午在实验室听了报告' },
      { no: 4, note: '实验室合影', group: 'A', after: '下午在实验室听了报告' },
    ])
    expect(enrichPhotos({ images, notes: {}, groups, anchors })).toEqual([])
  })

  it('keeps only anchor sentences that exist in the copy', () => {
    expect(keepSentences(TEXT, anchors)).toEqual(['来到一家工厂的装配车间', '下午在实验室听了报告'])
  })

  it('accepts an enriched copy that keeps headings and anchors', () => {
    const after = TEXT.replace('【待补充：工厂名称】', '这里是西门子安贝格工厂，装配线上的机械臂一刻不停。').replace('大家提了很多问题。', '大家提了很多问题。李老师在变流器样机前讲了它的控制方式。')
    const c = checkEnriched(TEXT, after, keepSentences(TEXT, anchors))
    expect(c.headingsChanged).toBe(false)
    expect(c.lostAnchors).toEqual([])
    expect(c.added).toBeGreaterThan(20)
  })

  it('flags changed headings and rewritten anchor sentences', () => {
    const after = TEXT.replace('## 实验室交流', '## 实验室里的一下午').replace('来到一家工厂的装配车间', '走进西门子工厂')
    const c = checkEnriched(TEXT, after, keepSentences(TEXT, anchors))
    expect(c.headingsChanged).toBe(true)
    expect(c.lostAnchors).toEqual(['来到一家工厂的装配车间'])
  })

  it('keeps the copy format: no # added to an unmarked draft', () => {
    const plain = '秋季文化节落幕\n\n十天里的一些片段。'
    expect(enrichedText({ markdown: '```markdown\n秋季文化节落幕\n\n十天里的一些片段，还有更多。\n```' }, plain)).toBe('秋季文化节落幕\n\n十天里的一些片段，还有更多。')
    expect(enrichedText({ markdown: '走进慕尼黑\n\n正文' }, TEXT)).toBe('# 走进慕尼黑\n\n正文')
  })
  it('reads the change list defensively', () => {
    expect(enrichChanges({ changes: ['补充了工厂名称', '', 3] })).toEqual(['补充了工厂名称', '3'])
    expect(enrichChanges({ markdown: 'x' })).toEqual([])
    expect(enrichChanges(null)).toEqual([])
  })
})
