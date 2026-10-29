import { useEffect, useMemo, useState } from 'react'
import { compileDoc, variantUrl } from '../core/compiler'
import { applyOps, describeOp } from '../core/ops'
import { QUICK_ACTIONS, aiContext } from '../core/quickActions'
import { analyzeStyle, themeFromReport, type StyleReport } from '../core/styleExtract'
import { getTheme, registerTheme, resolveTheme } from '../core/themes'
import type { Theme, ThemeTokens } from '../core/types'
import { api, type AiStatus } from './api'
import { CoverDesigner } from './CoverDesigner'
import { PropsForm } from './PropsForm'
import { selectedBlock, useStore } from './store'
import { PhonePreview } from './Toolbar'

type Tab = 'style' | 'theme' | 'ai' | 'reference'

function DocSettings() {
  const doc = useStore((s) => s.doc)
  const set = useStore((s) => s.setDocFields)
  const [designing, setDesigning] = useState(false)
  return (
    <div className="props-form">
      <h4>文章信息</h4>
      <label className="field"><span>标题（≤64 字）</span><input value={doc.title} maxLength={64} onChange={(e) => set({ title: e.target.value }, 'title')} /></label>
      <label className="field"><span>作者（≤16 字）</span><input value={doc.author} maxLength={16} onChange={(e) => set({ author: e.target.value }, 'author')} /></label>
      <label className="field"><span>摘要（≤120 字）</span><textarea rows={3} maxLength={120} value={doc.digest} onChange={(e) => set({ digest: e.target.value }, 'digest')} /></label>
      <div className="field">
        <span>公众号封面（2.35:1）</span>
        {doc.cover ? <img className="cover-preview" src={variantUrl(doc.cover.src, '235:100', 600)} alt="" /> : <p className="hint">尚未设置</p>}
        <button onClick={() => setDesigning(true)}>🎨 设计封面</button>
      </div>
      <p className="hint">提示：点击画布中的模块即可编辑该模块；双击正文类模块可直接编辑文字。</p>
      {designing && <CoverDesigner onClose={() => setDesigning(false)} />}
    </div>
  )
}

function ThemePanel() {
  const doc = useStore((s) => s.doc)
  const themes = useStore((s) => s.themes)
  const { commit, notify, refreshThemes } = useStore.getState()
  const theme = resolveTheme(doc)
  const setOverride = (patch: Partial<ThemeTokens>, key: string) => {
    const o = doc.themeOverrides ?? {}
    commit({ ...doc, themeOverrides: { ...o, ...patch, colors: { ...(o.colors ?? {}), ...(patch.colors ?? {}) } as any } }, `theme:${key}`)
  }
  const num = (label: string, key: keyof ThemeTokens, min: number, max: number, step = 1) => (
    <label className="field slider">
      <span>{label}<b>{String(theme[key])}</b></span>
      <input type="range" min={min} max={max} step={step} value={theme[key] as number} onChange={(e) => setOverride({ [key]: Number(e.target.value) } as any, key)} />
    </label>
  )
  const color = (label: string, key: keyof Theme['colors']) => (
    <label className="color-field">
      <input type="color" value={theme.colors[key]} onChange={(e) => setOverride({ colors: { [key]: e.target.value } as any }, `c-${key}`)} />
      <span>{label}</span>
    </label>
  )
  return (
    <div className="props-form">
      <h4>视觉主题 · 一键切换全文</h4>
      <div className="theme-grid">
        {themes.map((t) => (
          <button key={t.id} className={`theme-card ${doc.themeId === t.id ? 'on' : ''}`} onClick={() => commit({ ...doc, themeId: t.id, themeOverrides: undefined })} title={t.description} data-testid={`theme-${t.id}`}>
            <span className="swatch">
              {[t.colors.primary, t.colors.accent, t.colors.primarySoft].map((c) => <i key={c} style={{ background: c }} />)}
            </span>
            <b>{t.name}</b>
          </button>
        ))}
      </div>
      <button
        className="wide"
        title="把封面、标题、卡片、引言、分割的样式都改为“跟随主题”，切换主题时整体变化"
        onClick={() => commit({ ...doc, blocks: doc.blocks.map((b) => ('variant' in b.props && ['cover', 'heading', 'card', 'quote', 'divider'].includes(b.type) ? ({ ...b, props: { ...b.props, variant: 'auto' } } as typeof b) : b)) })}
      >
        全部模块样式跟随主题
      </button>
      <h4>微调{doc.themeOverrides && <button className="link" onClick={() => commit({ ...doc, themeOverrides: undefined })}>重置</button>}</h4>
      <div className="color-row">{color('主色', 'primary')}{color('强调', 'accent')}{color('浅底', 'primarySoft')}{color('正文', 'text')}{color('辅助', 'muted')}</div>
      {num('正文字号', 'fontSize', 13, 18)}
      {num('大标题字号', 'h1Size', 18, 32)}
      {num('小标题字号', 'h2Size', 15, 24)}
      {num('行距', 'lineHeight', 1.4, 2.4, 0.05)}
      {num('字间距', 'letterSpacing', 0, 2, 0.1)}
      {num('段落间距', 'paragraphSpacing', 6, 32)}
      {num('模块间距', 'blockSpacing', 12, 48)}
      {num('圆角', 'radius', 0, 20)}
      {num('图片圆角', 'imageRadius', 0, 20)}
      <button
        className="wide"
        onClick={async () => {
          const name = prompt('保存为我的主题，名称：', `${getTheme(doc.themeId).name} · 自定义`)
          if (!name) return
          const t: Theme = { ...theme, id: `custom-${Date.now().toString(36)}`, name, description: '用户自定义主题' }
          await api.saveTheme(t)
          registerTheme(t)
          refreshThemes()
          commit({ ...doc, themeId: t.id, themeOverrides: undefined })
          notify('主题已保存')
        }}
      >
        保存为我的主题
      </button>
    </div>
  )
}

function AiPanel() {
  const doc = useStore((s) => s.doc)
  const proposal = useStore((s) => s.proposal)
  const { propose, resolveProposal, clearProposal, notify } = useStore.getState()
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => {
    const load = () => api.aiStatus().then(setAi).catch(() => setAi(null))
    load()
    window.addEventListener('ai-settings-changed', load)
    return () => window.removeEventListener('ai-settings-changed', load)
  }, [])
  const run = async () => {
    if (!instruction.trim()) return
    setBusy(true)
    try {
      const r = await api.aiEdit(aiContext(doc), instruction)
      propose(r.summary ?? 'AI 修改建议', Array.isArray(r.ops) ? r.ops : [])
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const pending = proposal?.items.filter((i) => i.status === 'pending') ?? []
  return (
    <div className="props-form">
      <h4>AI 设计助手</h4>
      <p className={`ai-status ${ai?.enabled ? 'on' : ''}`}>
        {ai?.enabled ? `当前模型：${ai.name} / ${ai.model}` : '尚未配置 AI 模型。以下规则动作可离线使用。'}{' '}
        <button className="link" onClick={() => window.dispatchEvent(new Event('open-ai-settings'))}>{ai?.enabled ? '切换' : '去配置'}</button>
      </p>
      <textarea
        rows={3}
        placeholder={ai?.enabled ? '例如：把第二章改成时间轴；给开头加一张数据卡片；整体语气更活泼但不改事实' : '配置大模型后可输入自然语言指令'}
        value={instruction}
        disabled={!ai?.enabled}
        onChange={(e) => setInstruction(e.target.value)}
      />
      <button className="primary wide" disabled={!ai?.enabled || busy} onClick={run}>{busy ? 'AI 思考中…' : '生成修改建议'}</button>
      <h4>规则动作</h4>
      <div className="quick-grid">
        {QUICK_ACTIONS.map((a) => (
          <button key={a.id} onClick={() => { const r = a.run(doc); propose(r.summary, r.ops) }} data-testid={`qa-${a.id}`}>{a.label}</button>
        ))}
      </div>
      {proposal && (
        <div className="proposal" data-testid="proposal">
          <div className="proposal-head">
            <b>{proposal.summary}</b>
            <button className="link" onClick={clearProposal}>关闭</button>
          </div>
          {proposal.errors.length > 0 && <p className="warn">已忽略 {proposal.errors.length} 条无效操作：{proposal.errors.join('；')}</p>}
          {proposal.items.map((it, i) => {
            const d = describeOp(proposal.base, it.op)
            return (
              <div key={i} className={`op ${it.status}`}>
                <div className="op-title">{d.title}</div>
                {it.op.reason && <div className="op-reason">{it.op.reason}</div>}
                {d.before && <div className="diff del">− {d.before.slice(0, 160)}</div>}
                {d.after && <div className="diff add">＋ {d.after.slice(0, 160)}</div>}
                {it.status === 'pending' ? (
                  <div className="op-actions">
                    <button onClick={() => resolveProposal(i, 'rejected')}>拒绝</button>
                    <button className="primary" onClick={() => resolveProposal(i, 'accepted')}>接受</button>
                  </div>
                ) : (
                  <div className="op-state">{it.status === 'accepted' ? '已接受' : '已拒绝'}</div>
                )}
              </div>
            )
          })}
          {pending.length > 0 && (
            <div className="op-actions all">
              <button onClick={() => setPreview(compileDoc(applyOps(doc, pending.map((p) => p.op))).html)}>预览效果</button>
              <button onClick={() => resolveProposal('all', 'rejected')}>全部拒绝</button>
              <button className="primary" onClick={() => resolveProposal('all', 'accepted')} data-testid="accept-all">全部接受（{pending.length}）</button>
            </div>
          )}
          <p className="hint">接受后的修改可用 Ctrl+Z 撤销。</p>
        </div>
      )}
      {preview && <PhonePreview html={preview} title="AI 修改预览（未应用）" onClose={() => setPreview(null)} />}
    </div>
  )
}

function ReferencePanel() {
  const [html, setHtml] = useState('')
  const [url, setUrl] = useState('')
  const [report, setReport] = useState<StyleReport | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const { commit, notify, refreshThemes } = useStore.getState()
  const draft = useMemo(() => (report ? themeFromReport(report, '参考风格主题') : null), [report])
  const analyze = (source: string) => {
    const dom = new DOMParser().parseFromString(source, 'text/html')
    const r = analyzeStyle(dom.body)
    if (r.sampleCount < 3) return notify('样式样本太少：请粘贴带内联样式的公众号文章 HTML', 'error')
    setReport(r)
  }
  return (
    <div className="props-form">
      <h4>参考风格学习</h4>
      <p className="hint">只提取字号层级、颜色、行距、间距、圆角与装饰倾向等数值参数，生成全新的原创主题；不复制原文结构、文字或素材。</p>
      <label className="check">
        <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} />
        我确认对参考文章拥有使用权或已获授权
      </label>
      <label className="field"><span>公众号文章链接</span><input value={url} placeholder="https://mp.weixin.qq.com/s/..." onChange={(e) => setUrl(e.target.value)} /></label>
      <button
        disabled={!authorized || !url}
        onClick={async () => {
          try {
            analyze((await api.fetchReference(url)).html)
          } catch (e: any) {
            notify(e.message, 'error')
          }
        }}
      >
        抓取并分析
      </button>
      <label className="field"><span>或粘贴文章 HTML（在浏览器中复制正文后，用开发者工具复制 #js_content 元素）</span><textarea rows={4} value={html} onChange={(e) => setHtml(e.target.value)} /></label>
      <button disabled={!authorized || !html} onClick={() => analyze(html)}>分析粘贴内容</button>
      {report && draft && (
        <div className="report">
          <h4>提取结果（{report.sampleCount} 个样式样本）</h4>
          <div className="color-row">
            {report.colors.slice(0, 6).map((c) => <i key={c.color} className="dot" style={{ background: c.color }} title={`${c.color} ×${c.count}`} />)}
          </div>
          <p>字号：{report.fontSizes.map((f) => `${f.size}px`).join(' / ')}</p>
          <p>行距 {report.lineHeight} · 字距 {report.letterSpacing}px · 段距 {report.paragraphSpacing}px · 圆角 {report.radius}px</p>
          <p>装饰倾向：竖线 {report.traits.borderLeft} · 胶囊 {report.traits.pill} · 居中 {report.traits.centered} · 图片 {report.traits.images}</p>
          <h4>生成的主题</h4>
          <div className="color-row">
            {Object.entries(draft.colors).map(([k, c]) => <i key={k} className="dot" style={{ background: c }} title={`${k} ${c}`} />)}
          </div>
          <p>标题样式 {draft.headingVariant} · 引言 {draft.quoteVariant} · 卡片 {draft.cardVariant}</p>
          <button
            className="primary wide"
            onClick={async () => {
              const name = prompt('新主题名称', '我的参考风格') ?? '我的参考风格'
              const t = { ...draft, name }
              await api.saveTheme(t)
              registerTheme(t)
              refreshThemes()
              commit({ ...useStore.getState().doc, themeId: t.id, themeOverrides: undefined })
              notify(`已创建并应用主题「${name}」`)
            }}
          >
            保存并应用为新主题
          </button>
        </div>
      )}
    </div>
  )
}

export function RightPanel() {
  const [tab, setTab] = useState<Tab>('style')
  const block = useStore(selectedBlock)
  const hasProposal = useStore((s) => !!s.proposal)
  useEffect(() => {
    if (hasProposal) setTab('ai')
  }, [hasProposal])
  return (
    <aside className="panel right">
      <nav className="tabs">
        {(['style', 'theme', 'ai', 'reference'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={`tab-${t}`}>
            {{ style: block ? '模块' : '文章', theme: '主题', ai: 'AI 设计', reference: '参考风格' }[t]}
          </button>
        ))}
      </nav>
      <div className="panel-body">
        {tab === 'style' && (block ? <PropsForm key={block.id} block={block} /> : <DocSettings />)}
        {tab === 'theme' && <ThemePanel />}
        {tab === 'ai' && <AiPanel />}
        {tab === 'reference' && <ReferencePanel />}
      </div>
    </aside>
  )
}
