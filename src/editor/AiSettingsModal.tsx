import { useEffect, useState } from 'react'
import { api, type AiProfile, type ModelInfo } from './api'
import { AI_PRESETS } from './aiPresets'
import { Modal } from './Modal'
import { useStore } from './store'

const blank = (): AiProfile => ({ id: '', name: '', provider: 'openai', baseUrl: '', apiKey: '', model: '', jsonMode: true })

/** 没检测过时下拉里给的常见思考强度；不一定都被模型接受，点「检测」后只列真正接受的 */
const COMMON_EFFORTS: Record<AiProfile['provider'], string[]> = {
  openai: ['minimal', 'low', 'medium', 'high'],
  anthropic: ['low', 'medium', 'high', 'xhigh', 'max'],
}
const EFFORT_LABEL: Record<string, string> = { none: 'none（关闭思考）', minimal: 'minimal（最少）', low: 'low（低）', medium: 'medium（中）', high: 'high（高）', xhigh: 'xhigh（很高）', max: 'max（最高）' }

/** 128000 → 128K，1000000 → 1M */
export const fmtTokens = (n = 0) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url)
const validExtra = (v = '') => {
  if (!v.trim()) return true
  try {
    const o = JSON.parse(v)
    return !!o && typeof o === 'object' && !Array.isArray(o)
  } catch {
    return false
  }
}

/** AI 模型设置：可保存多套配置并选择当前使用的一套。密钥只保存在本机。 */
export function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const notify = useStore((s) => s.notify)
  const [profiles, setProfiles] = useState<AiProfile[]>([])
  const [activeId, setActiveId] = useState('')
  const [editing, setEditing] = useState<number>(-1)
  const [testing, setTesting] = useState('')
  const [busy, setBusy] = useState(false)
  // 上游模型列表按配置 id 缓存；说明文字按配置 id 记，切换配置后不会串
  const [models, setModels] = useState<Record<string, ModelInfo[]>>({})
  const [modelNote, setModelNote] = useState<Record<string, string>>({})
  const [effortNote, setEffortNote] = useState<Record<string, string>>({})
  const [working, setWorking] = useState('')
  // 设置读取完成前不能新增：否则读取结果会覆盖刚选的预设
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // 开发模式下 effect 会跑两遍：只采用最后一次请求的结果，否则晚到的那份会盖掉用户刚添加的配置
    let alive = true
    api
      .aiSettings()
      .then((s) => {
        if (!alive) return
        setProfiles(s.profiles)
        setActiveId(s.activeId)
        if (!s.profiles.length) setEditing(-2)
        setLoaded(true)
      })
      .catch((e) => alive && notify(e.message, 'error'))
    return () => {
      alive = false
    }
  }, [notify])

  const cur = editing >= 0 ? profiles[editing] : null
  const patch = (p: Partial<AiProfile>) => setProfiles((list) => list.map((x, i) => (i === editing ? { ...x, ...p } : x)))
  // 异步结果按配置 id 写回，用户中途切到别的配置也不会写错地方
  const patchId = (id: string, p: Partial<AiProfile>) => setProfiles((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x)))

  /** 从上游读取模型列表。quiet：自动触发（密钥还没填就不请求，失败只在下方提示一句） */
  const loadModels = async (p: AiProfile, quiet = false) => {
    if (!p.baseUrl) return
    if (quiet && !p.apiKey && !p.hasKey && !isLocal(p.baseUrl)) return
    setWorking(`models:${p.id}`)
    try {
      const r = await api.aiModels(p)
      setModels((m) => ({ ...m, [p.id]: r.models }))
      setModelNote((m) => ({ ...m, [p.id]: r.models.length ? `已从上游获取 ${r.models.length} 个模型，可在模型名称里选择` : '上游返回的模型列表是空的，请手动填写模型名' }))
    } catch (e: any) {
      setModelNote((m) => ({ ...m, [p.id]: `获取模型列表失败：${e.message}` }))
    } finally {
      setWorking('')
    }
  }

  /** 选中或输入了列表里的模型：带上它的上下文、输出上限和思考强度 */
  const pickModel = (p: AiProfile, model: string) => {
    const hit = models[p.id]?.find((m) => m.id === model)
    if (!hit) return patchId(p.id, { model })
    patchId(p.id, {
      model,
      contextWindow: hit.contextWindow ?? 0,
      maxOutputTokens: hit.maxOutput ?? 0,
      ...(hit.efforts && { efforts: hit.efforts, reasoningEffort: hit.efforts.includes(p.reasoningEffort ?? '') ? p.reasoningEffort : '' }),
    })
  }

  const probe = async (p: AiProfile) => {
    setWorking(`effort:${p.id}`)
    setEffortNote((m) => ({ ...m, [p.id]: '检测中…每个强度发一条极短的请求，需要几十秒' }))
    try {
      const r = await api.probeEffort(p)
      if (r.baseError) {
        setEffortNote((m) => ({ ...m, [p.id]: `✕ 基本请求就失败了，先点「测试连接」排查：${r.baseError}` }))
        return
      }
      patchId(p.id, { efforts: r.supported, reasoningEffort: r.supported.includes(p.reasoningEffort ?? '') ? p.reasoningEffort : '' })
      const rejected = r.rejected.map((x) => x.effort).join('、')
      const first = r.rejected[0]?.message
      setEffortNote((m) => ({
        ...m,
        [p.id]: r.ignored
          ? '⚠ 这个服务不校验思考强度（连无效的值也接受），无法判断哪些真正生效；下拉里仍按常见值列出，是否起作用请看模型文档'
          : r.supported.length
            ? `✓ 接受：${r.supported.join('、')}${rejected ? `；被拒绝：${rejected}${first ? `（${first}）` : ''}` : ''}`
            : `这个模型不接受思考强度参数${first ? `：${first}` : ''}，选「默认」即可`,
      }))
      // 检测结果出来后，把没有任何强度被接受、或服务不校验的情况下的列表清掉，避免误导
      if (r.ignored || !r.supported.length) patchId(p.id, { efforts: [] })
    } catch (e: any) {
      setEffortNote((m) => ({ ...m, [p.id]: `✕ ${e.message}` }))
    } finally {
      setWorking('')
    }
  }

  const addFromPreset = (key: string) => {
    const pre = AI_PRESETS.find((p) => p.key === key)!
    const p: AiProfile = { ...blank(), id: `p${Date.now().toString(36)}`, name: pre.name.replace(/（.*）/, ''), provider: pre.provider, baseUrl: pre.baseUrl, model: pre.model }
    setProfiles((list) => [...list, p])
    setEditing(profiles.length)
    if (!activeId) setActiveId(p.id)
  }

  const save = async () => {
    setBusy(true)
    try {
      const s = await api.saveAiSettings({ activeId, profiles: profiles.filter((p) => !p.readonly) })
      setProfiles(s.profiles)
      setActiveId(s.activeId)
      notify('AI 模型设置已保存')
      window.dispatchEvent(new Event('ai-settings-changed'))
      onClose()
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const test = async (p: AiProfile) => {
    setTesting('测试中…')
    try {
      const r = await api.testAi(p)
      setTesting(r.ok ? `✓ 连接成功（${(r.ms / 1000).toFixed(1)} 秒）` : `已响应但格式异常：${JSON.stringify(r.reply).slice(0, 80)}`)
    } catch (e: any) {
      setTesting(`✕ ${e.message}`)
    }
  }

  const preset = cur ? AI_PRESETS.find((x) => x.baseUrl && x.baseUrl === cur.baseUrl) : undefined
  return (
    <Modal title="AI 模型设置" onClose={onClose} width={760}>
      <div className="ai-settings">
        <div className="ai-list">
          {profiles.map((p, i) => (
            <div key={p.id || i} className={`ai-item ${i === editing ? 'on' : ''}`} onClick={() => (setEditing(i), setTesting(''), !models[p.id] && loadModels(p, true))}>
              <label onClick={(e) => e.stopPropagation()} title="设为当前使用">
                <input type="radio" name="active" checked={activeId === p.id} onChange={() => setActiveId(p.id)} />
              </label>
              <div className="grow">
                <b>{p.name || '未命名'}</b>
                <small>{p.model || '未填写模型'}{p.readonly ? ' · 只读' : ''}</small>
              </div>
            </div>
          ))}
          <select value="" disabled={!loaded} onChange={(e) => e.target.value && addFromPreset(e.target.value)} data-testid="ai-add-preset">
            <option value="">＋ 添加模型…</option>
            {AI_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          <p className="hint">单选按钮 = 当前使用的模型。密钥只保存在本机 data/settings.json，页面上只显示打码后的值。</p>
        </div>
        <div className="ai-form">
          {!cur && <p className="empty">从左侧选择一项，或添加新的模型服务。</p>}
          {cur && (
            <>
              {cur.readonly && <p className="warn">此项来自 .env 文件，只能在 .env 中修改。</p>}
              <label className="field"><span>名称</span><input value={cur.name} disabled={cur.readonly} onChange={(e) => patch({ name: e.target.value })} /></label>
              <label className="field">
                <span>接口类型</span>
                <div className="seg">
                  <button className={cur.provider === 'openai' ? 'on' : ''} disabled={cur.readonly} onClick={() => patch({ provider: 'openai' })}>OpenAI 兼容</button>
                  <button className={cur.provider === 'anthropic' ? 'on' : ''} disabled={cur.readonly} onClick={() => patch({ provider: 'anthropic' })}>Anthropic Claude</button>
                </div>
              </label>
              <label className="field"><span>接口地址 Base URL</span><input value={cur.baseUrl} disabled={cur.readonly} placeholder="https://…/v1" onChange={(e) => patch({ baseUrl: e.target.value })} onBlur={() => loadModels(cur, true)} /></label>
              <label className="field">
                <span>API Key{preset?.keyUrl && <a href={preset.keyUrl} target="_blank" rel="noreferrer">获取密钥 ↗</a>}</span>
                <input type="password" value={cur.apiKey} disabled={cur.readonly} placeholder={cur.hasKey ? '已保存（留空则不修改）' : '粘贴密钥'} autoComplete="off" onChange={(e) => patch({ apiKey: e.target.value })} onBlur={() => cur.apiKey && loadModels(cur, true)} />
              </label>
              <label className="field">
                <span>
                  模型名称
                  <button type="button" className="link" disabled={!cur.baseUrl || working === `models:${cur.id}`} onClick={() => loadModels(cur)} data-testid="ai-load-models">
                    {working === `models:${cur.id}` ? '获取中…' : '从上游获取模型列表'}
                  </button>
                </span>
                <input
                  value={cur.model}
                  list={`ai-models-${cur.id}`}
                  disabled={cur.readonly}
                  placeholder="例如 deepseek-chat / qwen-plus / claude-sonnet-5-5"
                  onChange={(e) => pickModel(cur, e.target.value)}
                  data-testid="ai-model"
                />
                <datalist id={`ai-models-${cur.id}`}>
                  {(models[cur.id] ?? []).map((m) => (
                    <option key={m.id} value={m.id}>{[m.name, m.contextWindow && `上下文 ${fmtTokens(m.contextWindow)}`].filter(Boolean).join(' · ')}</option>
                  ))}
                </datalist>
              </label>
              {modelNote[cur.id] && <p className="hint" data-testid="ai-model-note">{modelNote[cur.id]}</p>}
              <div className="row gap ai-nums">
                <label className="field">
                  <span>上下文窗口（token）</span>
                  <input type="number" min={0} step={1000} value={cur.contextWindow || ''} disabled={cur.readonly} placeholder="未知" onChange={(e) => patch({ contextWindow: Number(e.target.value) || 0 })} data-testid="ai-context" />
                </label>
                <label className="field">
                  <span>单次最大输出（token）</span>
                  <input type="number" min={0} step={1000} value={cur.maxOutputTokens || ''} disabled={cur.readonly} placeholder="未知" onChange={(e) => patch({ maxOutputTokens: Number(e.target.value) || 0 })} data-testid="ai-max-output" />
                </label>
              </div>
              {(cur.contextWindow || cur.maxOutputTokens) ? <p className="hint">{cur.contextWindow ? `上下文 ${fmtTokens(cur.contextWindow)}` : ''}{cur.contextWindow && cur.maxOutputTokens ? ' · ' : ''}{cur.maxOutputTokens ? `请求的输出上限不会超过 ${fmtTokens(cur.maxOutputTokens)}` : ''}</p> : null}
              <label className="field">
                <span>
                  思考强度
                  <button type="button" className="link" disabled={!cur.baseUrl || !cur.model || !!working} onClick={() => probe(cur)} data-testid="ai-probe-effort">
                    {working === `effort:${cur.id}` ? '检测中…' : '检测支持的强度'}
                  </button>
                </span>
                <select value={cur.reasoningEffort ?? ''} disabled={cur.readonly} onChange={(e) => patch({ reasoningEffort: e.target.value })} data-testid="ai-effort">
                  <option value="">默认（不发送，用模型自己的设置）</option>
                  {[...new Set([...(cur.efforts?.length ? cur.efforts : COMMON_EFFORTS[cur.provider]), ...(cur.reasoningEffort ? [cur.reasoningEffort] : [])])].map((e) => (
                    <option key={e} value={e}>{EFFORT_LABEL[e] ?? e}</option>
                  ))}
                </select>
              </label>
              <p className="hint" data-testid="ai-effort-note">
                {effortNote[cur.id] ?? (cur.efforts?.length ? `这个模型接受：${cur.efforts.join('、')}` : '还没检测过：下拉里是常见的值，不一定都被这个模型接受。第三方接口建议点「检测支持的强度」（会发出几条极短的请求）')}
              </p>
              <details className="ai-advanced">
                <summary>高级：额外的请求参数{cur.extraBody ? '（已设置）' : ''}</summary>
                <textarea
                  rows={3}
                  value={cur.extraBody ?? ''}
                  disabled={cur.readonly}
                  placeholder='{"enable_thinking": false}'
                  onChange={(e) => patch({ extraBody: e.target.value })}
                  data-testid="ai-extra-body"
                />
                <p className={`hint ${validExtra(cur.extraBody) ? '' : 'bad'}`}>
                  {validExtra(cur.extraBody) ? '合并进每次请求的 JSON，给第三方接口的特殊开关用（如关闭思考、指定推理预算）；不能改 model 和 messages。' : '不是有效的 JSON 对象，保存时会被丢弃。'}
                </p>
              </details>
              {preset?.note && <p className="hint">{preset.note}</p>}
              <label className="check">
                <input type="checkbox" checked={cur.jsonMode} disabled={cur.readonly} onChange={(e) => patch({ jsonMode: e.target.checked })} />
                请求 JSON 模式（response_format；服务不支持时会自动关闭重试）
              </label>
              <div className="row gap">
                <button onClick={() => test(cur)} disabled={!cur.baseUrl || !cur.model}>测试连接</button>
                {!cur.readonly && (
                  <button
                    className="danger"
                    onClick={() => {
                      setProfiles((l) => l.filter((_, i) => i !== editing))
                      setEditing(-1)
                    }}
                  >
                    删除
                  </button>
                )}
                <span className="hint">{testing}</span>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" disabled={busy} onClick={save}>保存</button>
      </div>
    </Modal>
  )
}
