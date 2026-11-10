import { lazy, Suspense, useEffect, useState } from 'react'
import { compileDoc, variantUrl } from '../core/compiler'
import { docToMarkdown } from '../core/exporters'
import { displayHtml } from '../core/images'
import { checkedXiumiParts, splitForXiumi, xiumiReport, xiumiSvgBoxes } from '../core/xiumiExport'
import { AiSettingsModal } from './AiSettingsModal'
import { api, type VersionSummary } from './api'
import { Modal } from './Modal'
import { normalizeDoc, saveNow, useStore } from './store'
import { compileForWechat, copyRichText, download, standaloneHtml, xiumiPackage, xiumiUploaded, type ImageMode } from './wechatOutput'

const ArticleImportModal = lazy(() => import('./ArticleImport').then((m) => ({ default: m.ArticleImportModal })))
const ImportWizard = lazy(() => import('./ImportWizard').then((m) => ({ default: m.ImportWizard })))

export function PhonePreview({ html, title, onClose }: { html: string; title: string; onClose: () => void }) {
  const doc = useStore((s) => s.doc)
  return (
    <Modal title={title} onClose={onClose} width={460}>
      <div className="phone-preview">
        <iframe title="手机预览" srcDoc={standaloneHtml(doc, displayHtml(html))} data-testid="preview-frame" />
      </div>
      <p className="hint">375px 宽度模拟公众号文章页。</p>
    </Modal>
  )
}

function VersionsModal({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc)
  const { commit, notify } = useStore.getState()
  const [list, setList] = useState<VersionSummary[]>([])
  const refresh = () => api.versions(doc.id).then(setList).catch(() => {})
  useEffect(() => {
    refresh()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="历史版本" onClose={onClose}>
      <button
        className="primary wide"
        onClick={async () => {
          const label = prompt('版本说明', `手动保存 ${new Date().toLocaleTimeString()}`)
          if (label === null) return
          await api.saveVersion(doc, label || '手动保存')
          refresh()
          notify('版本已保存')
        }}
      >
        保存当前为新版本
      </button>
      <p className="hint">恢复版本后可用 Ctrl+Z 撤回恢复操作；每个项目保留最近 50 个版本。</p>
      {list.map((v) => (
        <div key={v.id} className="list-row">
          <div className="grow">
            <b>{v.label}</b>
            <small>{new Date(v.createdAt).toLocaleString()} · {v.blockCount} 个模块</small>
          </div>
          <button
            onClick={async () => {
              const { doc: old } = await api.version(doc.id, v.id)
              commit(normalizeDoc({ ...old, id: doc.id }))
              notify(`已恢复「${v.label}」`)
              onClose()
            }}
          >
            恢复
          </button>
        </div>
      ))}
      {!list.length && <p className="empty">还没有保存过版本</p>}
    </Modal>
  )
}

function ExportModal({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc)
  const notify = useStore((s) => s.notify)
  const [wx, setWx] = useState<{ configured: boolean } | null>(null)
  const [mode, setMode] = useState<ImageMode>('embed')
  const [busy, setBusy] = useState('')
  const [report, setReport] = useState<{ charCount: number; warnings: string[] } | null>(null)
  const [draftOpen, setDraftOpen] = useState(false)
  useEffect(() => {
    api.wechatStatus().then(setWx).catch(() => setWx({ configured: false }))
  }, [])
  const base = compileDoc(doc)
  const safeName = (doc.title || 'article').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  const xiumi = xiumiReport(base.html)
  const xiumiParts = splitForXiumi(xiumiSvgBoxes(base.html)).length
  /** 超出秀米一次导入的上限时先提示会导出多份文件；用户取消就不下载 */
  const confirmParts = (parts: number) =>
    parts <= 1 || confirm(`这篇超出秀米一次导入的上限（约 13 万字符，超出部分会被秀米丢掉），将导出 ${parts} 份文件（打包为 zip）。\n\n请下载后解压，按「导入秀米-1.txt」到「导入秀米-${parts}.txt」的顺序依次导入秀米。\n\n点“确定”继续导出（上传模式会先上传图片）。`)
  const runXiumi = async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusy('')
    }
  }

  const copy = async () => {
    setBusy('准备中…')
    try {
      const compiled = compileForWechat(doc, mode, setBusy).then((r) => (setReport(r), r.html))
      const how = await copyRichText(compiled)
      notify(`已复制（${how === 'clipboard-api' ? '富文本' : '兼容模式'}），到公众号后台编辑器中 Ctrl+V 粘贴`)
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusy('')
    }
  }

  return (
    <Modal title="导出与发布" onClose={onClose} width={620}>
      <section className="export-section">
        <h4>复制到公众号后台</h4>
        <div className="seg">
          <button className={mode === 'embed' ? 'on' : ''} onClick={() => setMode('embed')}>内嵌图片</button>
          <button className={mode === 'wechat' ? 'on' : ''} disabled={!wx?.configured} onClick={() => setMode('wechat')} title={wx?.configured ? '' : '需在 .env 配置公众号 AppID/AppSecret'}>上传到微信图床</button>
          <button className={mode === 'absolute' ? 'on' : ''} onClick={() => setMode('absolute')}>原图链接</button>
        </div>
        <p className="hint">
          {mode === 'embed' && '图片以 base64 内嵌在剪贴板中，无需公网图床。是否被公众号后台自动转存尚未在真实后台验证，粘贴后请检查图片。'}
          {mode === 'wechat' && '先调用 media/uploadimg 把图片上传到微信，正文使用 mmbiz 域名图片，最稳妥。'}
          {mode === 'absolute' && '使用本机地址，仅适合部署到公网服务器后使用；localhost 地址在微信中无法显示。'}
        </p>
        <button className="primary wide" disabled={!!busy} onClick={copy} data-testid="copy-wechat">{busy || '复制到剪贴板'}</button>
        {report && (
          <div className="report">
            <p>HTML 长度 {report.charCount.toLocaleString()} 字符</p>
            {report.warnings.length ? report.warnings.map((w) => <p key={w} className="warn">⚠ {w}</p>) : <p className="ok">✓ 通过静态兼容检查（不等于真机验证）</p>}
          </div>
        )}
      </section>

      <section className="export-section">
        <h4>推送到草稿箱</h4>
        <p className="hint">{wx?.configured ? '已配置公众号接口。推送前会再次确认，只会创建草稿，不会群发。' : '未配置：在项目根目录 .env 中填写 WECHAT_APPID / WECHAT_APPSECRET 并在公众号后台添加 IP 白名单后重启服务。'}</p>
        <button className="wide" disabled={!wx?.configured} onClick={() => setDraftOpen(true)}>推送到草稿箱…</button>
      </section>

      <section className="export-section" data-testid="xiumi-section">
        <h4>导入秀米</h4>
        <p className="hint">秀米不接受内嵌图片，但能显示微信图床的图片。{xiumi.localImages ? `这篇有 ${xiumi.localImages} 张本地图片需要处理。` : '这篇没有本地图片，可以直接导入。'}</p>
        {xiumi.backgrounds > 0 && <p className="hint">有 {xiumi.backgrounds} 处背景图（如轮播）：导入后能显示，但在秀米里不能单独选中编辑。</p>}
        {xiumiParts > 1 && <p className="warn" data-testid="xiumi-parts">⚠ 这篇超出秀米一次导入的上限（约 13 万字符，超出部分会被秀米丢掉），将导出 {xiumiParts} 份文件，请下载后依次导入秀米。</p>}
        {xiumi.dataImages > 0 && <p className="warn">⚠ 有 {xiumi.dataImages} 处导入时自带的内嵌图片，秀米会换成占位图。</p>}
        {xiumi.localBackgrounds > 0 && !wx?.configured && <p className="warn">⚠ 有 {xiumi.localBackgrounds} 处背景图用了本地素材。不配置微信接口的话，它们在秀米里无法替换。</p>}
        <div className="row gap">
          {xiumi.localImages > 0 && (
            <button
              className="primary"
              disabled={!!busy || !wx?.configured}
              title={wx?.configured ? '' : '需在 .env 配置公众号 AppID/AppSecret'}
              data-testid="xiumi-upload"
              onClick={() =>
                runXiumi(async () => {
                  if (!confirmParts(checkedXiumiParts(base.html).length)) return
                  setBusy('上传图片…')
                  const r = await xiumiUploaded(doc, setBusy)
                  download(`${safeName}-${r.name}`, r.blob)
                  notify(r.parts > 1 ? `已下载，解压后按「说明.txt」依次导入 ${r.parts} 个文件` : '已下载，在秀米“导入 HTML 代码”里使用')
                })
              }
            >
              上传图片到微信并下载
            </button>
          )}
          <button
            disabled={!!busy}
            data-testid="xiumi-package"
            onClick={() =>
              runXiumi(async () => {
                setBusy('打包…')
                const r = await xiumiPackage(doc, setBusy)
                if (!confirmParts(r.parts)) return
                download(`${safeName}-${r.name}`, r.blob)
                notify(r.parts > 1 || r.images ? `已下载，解压后按「说明.txt」操作${r.parts > 1 ? `，依次导入 ${r.parts} 个文件` : ''}${r.images ? `，导入后需手动替换 ${r.images} 张图片` : ''}` : '已下载，在秀米“导入 HTML 代码”里使用')
              })
            }
          >
            {xiumi.localImages ? '下载 HTML 和图片包（手动替换）' : '下载 HTML'}
          </button>
        </div>
        <p className="hint">
          {wx?.configured ? '“上传”会把本地图片发送到微信服务器，只存图片，不创建草稿，也不群发。' : '未配置微信接口时，只能导入后在秀米里手动替换图片。配置方法见上方“推送到草稿箱”。'}
        </p>
      </section>

      <section className="export-section">
        <h4>下载文件</h4>
        <p className="hint">当前 HTML 长度 {base.charCount.toLocaleString()} 字符{base.charCount >= 20000 ? '（超过草稿箱接口 2 万字符上限，可用复制方式发布）' : ''}。“图片内嵌”的文件不适合导入秀米。</p>
        <div className="row gap">
          <button onClick={() => download(`${safeName}.md`, docToMarkdown({ ...doc, blocks: doc.blocks }).replace(/\]\(\/media\//g, `](${location.origin}/media/`), 'text/markdown')}>Markdown</button>
          <button onClick={() => download(`${safeName}.json`, JSON.stringify(doc, null, 2), 'application/json')}>编辑器 JSON</button>
          <button
            onClick={async () => {
              setBusy('生成 HTML…')
              try {
                const r = await compileForWechat(doc, 'embed', setBusy)
                download(`${safeName}.html`, standaloneHtml(doc, r.html), 'text/html')
              } finally {
                setBusy('')
              }
            }}
          >
            微信 HTML（图片内嵌）
          </button>
        </div>
      </section>
      {draftOpen && <DraftModal onClose={() => setDraftOpen(false)} />}
    </Modal>
  )
}

function DraftModal({ onClose }: { onClose: () => void }) {
  const doc = useStore((s) => s.doc)
  const notify = useStore((s) => s.notify)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState('')
  const cover = doc.cover?.src
  const issues = [!doc.title.trim() && '缺少标题', !cover && '缺少封面（在「文章」面板设计或设置封面）', doc.digest.length > 120 && '摘要超过 120 字'].filter(Boolean) as string[]
  const push = async () => {
    try {
      setBusy('上传图片…')
      const r = await compileForWechat(doc, 'wechat', setBusy)
      if (r.charCount >= 20000) throw new Error(`正文 HTML ${r.charCount} 字符，超过接口 20,000 字符上限。请精简模块，或使用“复制到公众号后台”。`)
      setBusy('创建草稿…')
      const res = await api.wechatDraft({ title: doc.title, author: doc.author, digest: doc.digest, html: r.html, cover: cover!, confirm: true })
      setResult(`草稿已创建，media_id：${res.media_id}。请到公众号后台「草稿箱」中检查后再手动发布。`)
      notify('已推送到草稿箱')
    } catch (e: any) {
      notify(e.message, 'error')
      setResult(`失败：${e.message}`)
    } finally {
      setBusy('')
    }
  }
  return (
    <Modal title="确认推送到公众号草稿箱" onClose={onClose}>
      <dl className="kv">
        <dt>标题</dt><dd>{doc.title}</dd>
        <dt>作者</dt><dd>{doc.author || '（空）'}</dd>
        <dt>摘要</dt><dd>{doc.digest || '（空，微信将自动截取正文）'}</dd>
        <dt>封面</dt><dd>{cover ? <img className="cover-preview" src={variantUrl(cover, '235:100', 600)} alt="" /> : '未设置'}</dd>
      </dl>
      {issues.map((i) => <p key={i} className="warn">⚠ {i}</p>)}
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        我确认将以上内容和图片上传到我的公众号，并创建一篇草稿（不会群发）
      </label>
      {result && <p className="report">{result}</p>}
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" disabled={!confirmed || issues.length > 0 || !!busy} onClick={push}>{busy || '确认推送'}</button>
      </div>
    </Modal>
  )
}

export function Toolbar() {
  const doc = useStore((s) => s.doc)
  const saveStatus = useStore((s) => s.saveStatus)
  const saveError = useStore((s) => s.saveError)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const { undo, redo, setDocFields } = useStore.getState()
  const [modal, setModal] = useState<'' | 'preview' | 'versions' | 'export' | 'import' | 'ai' | 'article'>('')
  const [wizardTemplates, setWizardTemplates] = useState<string[] | undefined>()
  useEffect(() => {
    // 从「模板」面板打开时带上预选的模板
    const open = (e: Event) => {
      setWizardTemplates((e as CustomEvent<{ templateIds?: string[] }>).detail?.templateIds)
      setModal('import')
    }
    const ai = () => setModal('ai')
    window.addEventListener('open-import', open)
    window.addEventListener('open-ai-settings', ai)
    return () => {
      window.removeEventListener('open-import', open)
      window.removeEventListener('open-ai-settings', ai)
    }
  }, [])
  return (
    <header className="toolbar">
      <div className="brand">XIUMI <b>AI</b> Studio</div>
      <input className="title-input" value={doc.title} onChange={(e) => setDocFields({ title: e.target.value }, 'title')} aria-label="文章标题" />
      <span className={`save ${saveStatus}`} title={saveError} data-testid="save-status">
        {{ saved: '已保存', dirty: '未保存', saving: '保存中…', error: '保存失败' }[saveStatus]}
      </span>
      <div className="spacer" />
      <button onClick={undo} disabled={!canUndo} title="撤销 Ctrl+Z">↶ 撤销</button>
      <button onClick={redo} disabled={!canRedo} title="重做 Ctrl+Y">↷ 重做</button>
      <button onClick={() => (saveNow(), setModal('versions'))}>历史版本</button>
      <button onClick={() => setModal('preview')} data-testid="open-preview">📱 手机预览</button>
      <button onClick={() => setModal('ai')} data-testid="open-ai-settings">⚙ AI 模型</button>
      <button onClick={() => setModal('article')} data-testid="open-article-import">⤓ 导入推文</button>
      <button className="accent" onClick={() => (setWizardTemplates(undefined), setModal('import'))} data-testid="open-import">✨ AI 一键排版</button>
      <button className="primary" onClick={() => setModal('export')} data-testid="open-export">导出 / 发布</button>
      {modal === 'preview' && <PhonePreview html={compileDoc(doc).html} title="手机预览" onClose={() => setModal('')} />}
      {modal === 'versions' && <VersionsModal onClose={() => setModal('')} />}
      {modal === 'export' && <ExportModal onClose={() => setModal('')} />}
      {modal === 'ai' && <AiSettingsModal onClose={() => setModal('')} />}
      {modal === 'article' && (
        <Suspense fallback={null}>
          <ArticleImportModal onClose={() => setModal('')} />
        </Suspense>
      )}
      {modal === 'import' && (
        <Suspense fallback={null}>
          <ImportWizard onClose={() => setModal('')} initialTemplates={wizardTemplates} />
        </Suspense>
      )}
    </header>
  )
}
