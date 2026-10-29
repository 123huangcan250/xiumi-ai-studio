import { useEffect, useState } from 'react'
import { api, type AiProfile } from './api'
import { AI_PRESETS } from './aiPresets'
import { Modal } from './Modal'
import { useStore } from './store'

const blank = (): AiProfile => ({ id: '', name: '', provider: 'openai', baseUrl: '', apiKey: '', model: '', jsonMode: true })

/** AI 模型设置：可保存多套配置并选择当前使用的一套。密钥只保存在本机。 */
export function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const notify = useStore((s) => s.notify)
  const [profiles, setProfiles] = useState<AiProfile[]>([])
  const [activeId, setActiveId] = useState('')
  const [editing, setEditing] = useState<number>(-1)
  const [testing, setTesting] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .aiSettings()
      .then((s) => {
        setProfiles(s.profiles)
        setActiveId(s.activeId)
        if (!s.profiles.length) setEditing(-2)
      })
      .catch((e) => notify(e.message, 'error'))
  }, [notify])

  const cur = editing >= 0 ? profiles[editing] : null
  const patch = (p: Partial<AiProfile>) => setProfiles((list) => list.map((x, i) => (i === editing ? { ...x, ...p } : x)))

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
            <div key={p.id || i} className={`ai-item ${i === editing ? 'on' : ''}`} onClick={() => (setEditing(i), setTesting(''))}>
              <label onClick={(e) => e.stopPropagation()} title="设为当前使用">
                <input type="radio" name="active" checked={activeId === p.id} onChange={() => setActiveId(p.id)} />
              </label>
              <div className="grow">
                <b>{p.name || '未命名'}</b>
                <small>{p.model || '未填写模型'}{p.readonly ? ' · 只读' : ''}</small>
              </div>
            </div>
          ))}
          <select value="" onChange={(e) => e.target.value && addFromPreset(e.target.value)} data-testid="ai-add-preset">
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
              <label className="field"><span>模型名称</span><input value={cur.model} disabled={cur.readonly} placeholder="例如 deepseek-chat / qwen-plus / claude-sonnet-5-5" onChange={(e) => patch({ model: e.target.value })} /></label>
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
