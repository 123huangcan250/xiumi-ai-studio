import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from '../../server/importer'
import { validateDraft } from '../../server/wechat'

describe('word import', () => {
  it('maps mammoth HTML to markdown', () => {
    const md = htmlToMarkdown('<h1>标题</h1><p>导语<strong>重点</strong></p><h2>章节</h2><ul><li>一</li></ul><table><tr><td>项目</td><td>数据</td></tr><tr><td>人数</td><td>30</td></tr></table><p><img src="/media/a.jpg" /></p>')
    expect(md).toBe('# 标题\n\n导语**重点**\n\n## 章节\n\n- 一\n\n| 项目 | 数据 |\n| --- | --- |\n| 人数 | 30 |\n\n![](/media/a.jpg)')
  })
})

describe('draft validation', () => {
  const ok = { title: '标题', content: '<section><img src="https://mmbiz.qpic.cn/x.jpg"></section>', thumb_media_id: 'm1' }
  it('accepts a valid article', () => {
    expect(validateDraft(ok)).toEqual([])
  })
  it('rejects oversize content, local images and missing cover', () => {
    const errs = validateDraft({ title: '', content: `<img src="/media/a.jpg">${'x'.repeat(20000)}`, thumb_media_id: '' })
    expect(errs.join('|')).toMatch(/标题不能为空.*20,000.*未上传到微信.*缺少封面/)
  })
})
