// 导入公众号推文：链接抓取或粘贴富文本 → 保留原样式（原文片段）或重新排版 → 可保存为模板/主题
import { useMemo, useRef, useState } from 'react'
import { newId } from '../core/blocks'
import { compileDoc } from '../core/compiler'
import { analyzeStyle, themeFromReport } from '../core/styleExtract'
import { registerTheme } from '../core/themes'
import type { Doc } from '../core/types'
import { articleToHtmlBlocks, articleToMarkdown, extractArticle, type ImportedArticle } from '../core/wxImport'
import { api, assetRef, type Asset } from './api'
import { ImportWizard } from './ImportWizard'
import { Modal } from './Modal'
import { saveNow, useStore } from './store'

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')

export function ArticleImportModal({ onClose }: { onClose: () => void }) {
  const { load, notify, refreshThemes } = useStore.getState()
  const [tab, setTab] = useState<'url' | 'paste'>('url')
  const [url, setUrl] = useState('')
  const [article, setArticle] = useState<ImportedArticle | null>(null)
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<'keep' | 'relayout'>('keep')
  const [authorized, setAuthorized] = useState(false)
  const [asTemplate, setAsTemplate] = useState(true)
  const [templateName, setTemplateName] = useState('')
  const [asTheme, setAsTheme] = useState(false)
  const [busy, setBusy] = useState('')
  const [wizard, setWizard] = useState<{ text: string; images: Asset[] } | null>(null)
  const pasteRef = useRef<HTMLDivElement>(null)

  const blocks = useMemo(() => (article ? articleToHtmlBlocks(article.root) : []), [article])
  const imageCount = article ? article.root.querySelectorAll('img').length : 0
  const previewHtml = useMemo(
    () => (article ? compileDoc({ id: 'p', title, author: '', digest: '', themeId: 'minimal-magazine', blocks, createdAt: 0, updatedAt: 0 }).html : ''),
    [article, blocks, title],
  )

  const accept = (a: ImportedArticle) => {
    if (!a.root.textContent?.trim() && !a.root.querySelector('img')) throw new Error('没有识别到正文内容')
    setArticle(a)
    setTitle(a.title)
    setTemplateName(a.title.slice(0, 20) || '导入的推文模板')
  }

  const run = async (fn: () => Promise<void>, msg: string) => {
    setBusy(msg)
    try {
      await fn()
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusy('')
    }
  }

  const fetchUrl = () =>
    run(async () => {
      const { html } = await api.fetchArticle(url.trim())
      const doc = parse(html)
      if (!doc.querySelector('#js_content') && /环境异常|请在微信客户端打开|verify/i.test(html)) {
        throw new Error('公众号返回了验证页面，无法直接抓取。请在浏览器打开文章，全选复制正文后用「粘贴富文本」导入。')
      }
      accept(extractArticle(doc))
    }, '抓取中…')

  const onPaste = (e: React.ClipboardEvent) => {
    const html = e.clipboardData.getData('text/html')
    if (!html) return // 纯文本交给默认行为
    e.preventDefault()
    try {
      accept(extractArticle(parse(html)))
    } catch (err: any) {
      notify(err.message, 'error')
    }
  }

  const doImport = () =>
    run(async () => {
      if (!article) return
      if (mode === 'relayout') {
        setBusy('下载图片到素材库…')
        const { markdown, images } = articleToMarkdown({ ...article, title })
        const map = images.length ? await api.fetchAssets(images) : {}
        // 图片地址替换为本地素材，便于排版引擎按章节分配与裁切
        const md = markdown.replace(/!\[\]\(([^)]+)\)/g, (m, u) => (map[u] ? `![](/media/${map[u].file})` : m))
        window.dispatchEvent(new Event('assets-changed'))
        setWizard({ text: md, images: images.map((u) => map[u]).filter(Boolean) })
        return
      }
      // 保留原样式：封面下载到素材库（草稿箱需要本地封面）
      let cover: Doc['cover']
      if (article.cover) {
        setBusy('保存封面…')
        const r = await api.fetchAssets([article.cover]).catch(() => ({}) as Record<string, Asset>)
        if (r[article.cover]) cover = assetRef(r[article.cover])
      }
      const now = Date.now()
      const doc: Doc = { id: newId(), title, author: '', digest: article.digest.slice(0, 120), themeId: 'minimal-magazine', cover, blocks, createdAt: now, updatedAt: now }
      if (asTemplate) await api.saveTemplate(templateName || title || '导入的推文模板', blocks)
      if (asTheme) {
        const t = themeFromReport(analyzeStyle(article.root), `${(title || '导入').slice(0, 10)} · 风格`)
        await api.saveTheme(t)
        registerTheme(t)
        refreshThemes()
        doc.themeId = t.id
      }
      await saveNow()
      load(doc)
      await saveNow()
      window.dispatchEvent(new Event('templates-changed'))
      notify(`已导入 ${blocks.length} 个原文片段${asTemplate ? '，并保存为模板' : ''}`)
      onClose()
    }, '导入中…')

  if (wizard) return <ImportWizard onClose={onClose} initialText={wizard.text} initialImages={wizard.images} />

  return (
    <Modal title="导入公众号推文" onClose={onClose} width={article ? 980 : 640}>
      {!article ? (
        <>
          <nav className="seg" style={{ marginBottom: 12 }}>
            <button className={tab === 'url' ? 'on' : ''} onClick={() => setTab('url')}>文章链接</button>
            <button className={tab === 'paste' ? 'on' : ''} onClick={() => setTab('paste')}>粘贴富文本</button>
          </nav>
          {tab === 'url' ? (
            <div className="row gap">
              <input className="grow" value={url} placeholder="https://mp.weixin.qq.com/s/……" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url && fetchUrl()} data-testid="article-url" />
              <button className="primary" disabled={!url.trim() || !!busy} onClick={fetchUrl}>{busy || '抓取'}</button>
            </div>
          ) : (
            <div
              ref={pasteRef}
              className="paste-box"
              contentEditable
              suppressContentEditableWarning
              onPaste={onPaste}
              data-testid="article-paste"
            >
              在浏览器中打开文章，全选正文（Ctrl+A）并复制，然后点击这里按 Ctrl+V 粘贴。
            </div>
          )}
          <p className="hint">导入的内容仅供你本人编辑使用。请确保你对文章拥有使用权或已获授权；原文中的视频、音频、小程序卡片等组件无法导入，会以提示文字代替。</p>
        </>
      ) : (
        <div className="article-import">
          <div className="article-preview">
            <div className="mini-preview tall">
              <div className="mini-inner" dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </div>
          <div className="article-options">
            <label className="field"><span>标题</span><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <p className="hint">
              {article.account && <>来源公众号：{article.account} · </>}识别到 {blocks.length} 个版块、{imageCount} 张图片
              <button className="link" onClick={() => setArticle(null)}>重新选择</button>
            </p>
            <label className="field">
              <span>导入方式</span>
              <div className="seg">
                <button className={mode === 'keep' ? 'on' : ''} onClick={() => setMode('keep')} data-testid="mode-keep">保留原样式</button>
                <button className={mode === 'relayout' ? 'on' : ''} onClick={() => setMode('relayout')} data-testid="mode-relayout">提取内容重新排版</button>
              </div>
            </label>
            {mode === 'keep' ? (
              <>
                <p className="hint">每个版块成为一个「原文片段」模块：可拖动排序、双击改字、在右侧替换图片，也可单独收藏为模板。原文片段不受主题切换影响。</p>
                <label className="check"><input type="checkbox" checked={asTemplate} onChange={(e) => setAsTemplate(e.target.checked)} />同时保存为模板</label>
                {asTemplate && <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="模板名称" />}
                <label className="check"><input type="checkbox" checked={asTheme} onChange={(e) => setAsTheme(e.target.checked)} />提取配色与字号，另存为主题（之后可用于 AI 排版）</label>
              </>
            ) : (
              <p className="hint">提取标题、段落、图片、引语与表格，图片下载到素材库，然后进入「AI 一键排版」生成新的设计方案。</p>
            )}
            <label className="check">
              <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} data-testid="article-authorized" />
              我确认对该文章拥有使用权或已获授权，并自行承担版权责任
            </label>
            <div className="modal-actions">
              <button onClick={onClose}>取消</button>
              <button className="primary" disabled={!authorized || !!busy} onClick={doImport} data-testid="article-import">{busy || (mode === 'keep' ? '导入为新项目' : '下一步：重新排版')}</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
