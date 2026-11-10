import { useEffect, useRef, useState } from 'react'
import { api, type AiProfile } from './api'
import { AI_PRESETS } from './aiPresets'
import { Modal } from './Modal'
import { useStore } from './store'

const validExtra = (text = '') => {
  if (!text.trim()) return true
  try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) } catch { return false }
}
const COMMON_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

const blank = (): AiProfile => ({ id: '', name: '', provider: 'openai', baseUrl: '', apiKey: '', model: '', jsonMode: true })

/** AI 模型设置：可保存多套配置并选择当前使用的一套。密钥只保存在本机。 */
export function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const notify = useStore((s) => s.notify)
  const [profiles, setProfiles] = useState<AiProfile[]>([])
  const [activeId, setActiveId] = useState('')
  const [editing, setEditing] = useState<number>(-1)
  const [testing, setTesting] = useState('')
  const [probing, setProbing] = useState(false)
  const [effortNote, setEffortNote] = useState('')
  const actionRequest = useRef({ probe: 0, test: 0 })
  const [modelList, setModelList] = useState<Awaited<ReturnType<typeof api.aiModels>>>([])
  const [modelStatus, setModelStatus] = useState('')
  const [fetchingModels, setFetchingModels] = useState(false)
  const modelRequest = useRef({ generation: 0 })
  const [busy, setBusy] = useState(false)
  // 设置读取完成前不能新增：否则读取结果会覆盖刚选的预设
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
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
      .catch((e) => { if (alive) notify(e.message, 'error') })
    return () => { alive = false }
  }, [notify])

  const cur = editing >= 0 ? profiles[editing] : null
  useEffect(() => {
    modelRequest.current.generation++
    setModelList([])
    setModelStatus('')
    setFetchingModels(false)
    const requestState = modelRequest.current
    return () => { requestState.generation++ }
  }, [cur?.id, cur?.baseUrl, cur?.provider, cur?.apiKey])
  const fetchModels = async (p: AiProfile) => {
    const request = ++modelRequest.current.generation
    setFetchingModels(true)
    setModelList([])
    setModelStatus('正在获取模型…')
    try {
      const models = await api.aiModels(p)
      if (request !== modelRequest.current.generation) return
      setModelList(models)
      const matched = models.find((m) => m.id === p.model)
      if (matched?.contextWindow) setProfiles((list) => list.map((x) => x.id === p.id && x.model === p.model ? { ...x, contextWindow: matched.contextWindow } : x))
      setModelStatus(models.length ? `已获取 ${models.length} 个模型；未提供的参数请查阅服务商文档。` : '服务未返回模型，可手动填写。')
    } catch (e: any) {
      if (request === modelRequest.current.generation) setModelStatus(`${e.message}；可继续手动填写。`)
    } finally {
      if (request === modelRequest.current.generation) setFetchingModels(false)
    }
  }
  useEffect(() => {
    const state = actionRequest.current
    state.probe++
    state.test++
    setProbing(false)
    setEffortNote('')
    setTesting('')
    return () => { state.probe++; state.test++ }
  }, [cur?.id, cur?.baseUrl, cur?.provider, cur?.apiKey, cur?.model, cur?.extraBody, cur?.jsonMode, cur?.maxOutputTokens])

  const invalidate = () => {
    setFetchingModels(false)
    setProbing(false)
    setModelStatus('')
    setEffortNote('')
    setTesting('')
    modelRequest.current.generation++
    actionRequest.current.probe++
    actionRequest.current.test++
  }
  const close = () => { invalidate(); onClose() }
  const patch = (p: Partial<AiProfile>) => {
    // Invalidate synchronously, before a queued response can land after an edit.
    const endpoint = ['baseUrl', 'provider', 'apiKey'].some((key) => key in p)
    if (endpoint) modelRequest.current.generation++
    actionRequest.current.probe++
    actionRequest.current.test++
    setProbing(false)
    setTesting('')
    setEffortNote('')
    setProfiles((list) => list.map((x, i) => i === editing ? {
      ...x,
      ...(endpoint ? { contextWindow: 0, maxOutputTokens: 0, efforts: [], reasoningEffort: '' } : {}),
      ...p,
    } : x))
  }
  const selectModel = (id: string) => {
    const model = modelList.find((m) => m.id === id)
    patch({ model: id, contextWindow: model?.contextWindow ?? 0, maxOutputTokens: model?.maxOutput ?? 0, efforts: model?.efforts ?? model?.reasoningEfforts ?? [], reasoningEffort: '' })
  }

  const probe = async (p: AiProfile) => {
    const request = ++actionRequest.current.probe
    setProbing(true)
    setEffortNote('检测中…每个强度发一条请求，可能需要几分钟。')
    try {
      const r = await api.probeEffort(p)
      if (request !== actionRequest.current.probe) return
      if (r.baseError) { setEffortNote(`基本请求失败，请先测试连接：${r.baseError}`); return }
      const efforts = r.ignored ? [] : r.supported
      if (!p.readonly) setProfiles((list) => list.map((x) => x.id === p.id ? {
        ...x, efforts,
        reasoningEffort: r.ignored || efforts.includes(x.reasoningEffort ?? '') ? x.reasoningEffort : '',
      } : x))
      setEffortNote(r.ignored ? '这个服务连无效强度也接受，无法判断哪些真正生效，请查阅服务商文档。' :
        r.supported.length ? `接受：${r.supported.join('、')}${r.rejected.length ? `；被拒绝：${r.rejected.map((x) => x.effort).join('、')}` : ''}` : '这个模型不接受思考强度参数，请留空使用默认设置。')
    } catch (e: any) {
      if (request === actionRequest.current.probe) setEffortNote(`检测失败：${e.message}`)
    } finally {
      if (request === actionRequest.current.probe) setProbing(false)
    }
  }

  const addFromPreset = (key: string) => {
    const pre = AI_PRESETS.find((p) => p.key === key)!
    const p: AiProfile = { ...blank(), id: `p${Date.now().toString(36)}`, name: pre.name.replace(/（.*）/, ''), provider: pre.provider, baseUrl: pre.baseUrl, model: pre.model }
    invalidate()
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
      close()
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const test = async (p: AiProfile) => {
    const request = ++actionRequest.current.test
    setTesting('测试中…')
    try {
      const r = await api.testAi(p)
      if (request !== actionRequest.current.test) return
      setTesting(r.ok ? `✓ 连接成功（${(r.ms / 1000).toFixed(1)} 秒）` : `已响应但格式异常：${JSON.stringify(r.reply).slice(0, 80)}`)
    } catch (e: any) {
      if (request === actionRequest.current.test) setTesting(`✕ ${e.message}`)
    }
  }

  const preset = cur ? AI_PRESETS.find((x) => x.baseUrl && x.baseUrl === cur.baseUrl) : undefined
  return (
    <Modal title="AI 模型设置" onClose={close} width={760}>
      <div className="ai-settings">
        <div className="ai-list">
          {profiles.map((p, i) => (
            <div key={p.id || i} className={`ai-item ${i === editing ? 'on' : ''}`} onClick={() => { invalidate(); setEditing(i); setTesting('') }}>
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
              <label className="field"><span>接口地址 Base URL</span><input value={cur.baseUrl} disabled={cur.readonly} placeholder="https://…/v1" onChange={(e) => patch({ baseUrl: e.target.value })} /></label>
              <label className="field">
                <span>API Key{preset?.keyUrl && <a href={preset.keyUrl} target="_blank" rel="noreferrer">获取密钥 ↗</a>}</span>
                <input type="password" value={cur.apiKey} disabled={cur.readonly} placeholder={cur.hasKey ? '已保存（留空则不修改）' : '粘贴密钥'} autoComplete="off" onChange={(e) => patch({ apiKey: e.target.value })} />
              </label>
              <label className="field"><span>模型名称</span><input data-testid="ai-model" value={cur.model} disabled={cur.readonly} placeholder="例如 deepseek-chat / qwen-plus / claude-sonnet-5-5" onChange={(e) => selectModel(e.target.value)} /></label>
              <button data-testid="ai-load-models" disabled={!cur.baseUrl || fetchingModels} onClick={() => fetchModels(cur)}>{fetchingModels ? '获取中…' : '从服务商获取模型列表'}</button>
              {modelStatus && <p className="hint" role="status" data-testid="ai-model-note">{modelStatus}</p>}
              {modelList.length > 0 && (
                <label className="field"><span>可用模型（点击选择，也可在上方手动填写）</span>
                  <select
                    aria-label="可用模型"
                    size={Math.min(6, modelList.length + 1)}
                    value={modelList.some((m) => m.id === cur.model) ? cur.model : ''}
                    disabled={cur.readonly}
                    onChange={(e) => selectModel(e.target.value)}
                  >
                    <option value="" disabled>请选择模型…</option>
                    {modelList.map((m) => <option key={m.id} value={m.id}>{m.id}{m.contextWindow ? `（${m.contextWindow} tokens）` : ''}</option>)}
                  </select>
                </label>
              )}
              <label className="field"><span>上下文窗口（tokens，仅记录，不自动截断）</span><input data-testid="ai-context" type="number" min="0" step="1" value={cur.contextWindow || ''} disabled={cur.readonly} placeholder="上游未提供，可手动填写" onChange={(e) => patch({ contextWindow: Number(e.target.value) || 0 })} /></label>
              <label className="field"><span>思考强度（留空使用服务商默认）</span><input data-testid="ai-effort" list="ai-reasoning-efforts" value={cur.reasoningEffort ?? ''} disabled={cur.readonly} placeholder="例如 low / medium / high" onChange={(e) => patch({ reasoningEffort: e.target.value })} /></label>
              <datalist id="ai-reasoning-efforts">{(cur.efforts?.length ? cur.efforts : COMMON_EFFORTS).map((effort) => <option key={effort} value={effort} />)}</datalist>
              <p className="hint">仅填写服务商支持的强度；OpenAI 兼容接口发送 reasoning_effort / max_completion_tokens，Claude 发送 output_config.effort。设置强度时不发送 temperature；不支持的参数会显示错误。</p>
              <label className="field"><span>单次最大输出（tokens）</span><input data-testid="ai-max-output" type="number" min="0" step="1" value={cur.maxOutputTokens || ''} disabled={cur.readonly} placeholder="未知" onChange={(e) => patch({ maxOutputTokens: Number(e.target.value) || 0 })} /></label>
              <p className="hint">请求的输出上限不会超过此值；留空使用任务默认值。</p>
              <button data-testid="ai-probe-effort" disabled={!cur.baseUrl || !cur.model || probing} onClick={() => probe(cur)}>{probing ? '检测中…' : '检测支持的强度'}</button>
              <p className="hint">检测会向当前服务商发送多条请求，可能产生 API 费用；只有点击检测才会发送。</p>
              <p className="hint" data-testid="ai-effort-note">{effortNote || (cur.efforts?.length ? `已知强度：${cur.efforts.join('、')}` : '可手动填写服务商支持的强度，或点击检测。')}</p>
              <details className="ai-advanced">
                <summary>高级：额外的请求参数{cur.extraBody ? '（已设置）' : ''}</summary>
                <textarea data-testid="ai-extra-body" rows={3} value={cur.extraBody ?? ''} disabled={cur.readonly} placeholder='{"enable_thinking": false}' onChange={(e) => patch({ extraBody: e.target.value })} />
                <p className={`hint ${validExtra(cur.extraBody) ? '' : 'bad'}`}>{validExtra(cur.extraBody) ? '支持服务商专用 JSON 参数；不能覆盖模型、消息、输出上限、思考强度、温度或 JSON 模式。' : '不是有效的 JSON 对象，请修正后保存。'}</p>
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
                      invalidate()
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
        <button onClick={close}>取消</button>
        <button className="primary" disabled={!loaded || busy || profiles.some((p) => !validExtra(p.extraBody))} onClick={save}>保存</button>
      </div>
    </Modal>
  )
}
