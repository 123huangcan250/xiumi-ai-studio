// 从上游读取可用模型（id、上下文、输出上限、思考强度），并检测一个模型接受哪些思考强度。
// 只访问用户在「AI 模型设置」里填写的地址，带用户自己的密钥；不跟随重定向，避免把密钥带到别处。
import { chatText } from './ai'
import { cleanEffort, type AiProfile } from './settings'

export interface ModelInfo {
  id: string
  name?: string
  /** 上下文窗口（token） */
  contextWindow?: number
  /** 单次最大输出（token） */
  maxOutput?: number
  /** 上游明确声明支持的思考强度 */
  efforts?: string[]
}

const httpError = (message: string, status = 502) => Object.assign(new Error(message), { status })
const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined
}
const firstNum = (o: any, keys: string[]) => {
  for (const k of keys) {
    const n = num(o?.[k])
    if (n) return n
  }
  return undefined
}

const CONTEXT_KEYS = ['context_length', 'context_window', 'max_context_length', 'max_model_len', 'max_input_tokens', 'input_token_limit', 'inputTokenLimit', 'n_ctx']
const OUTPUT_KEYS = ['max_output_tokens', 'max_completion_tokens', 'output_token_limit', 'outputTokenLimit', 'max_tokens']

/** 各家的模型列表字段名不一样：OpenAI 兼容服务多数只有 id，OpenRouter、vLLM、Anthropic 等带上下文长度 */
export function parseModels(json: any): ModelInfo[] {
  const list: any[] = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : []
  const seen = new Set<string>()
  const out: ModelInfo[] = []
  for (const m of list) {
    if (out.length >= 500) break
    const id = typeof m === 'string' ? m : typeof m?.id === 'string' ? m.id : typeof m?.name === 'string' ? m.name : ''
    if (!id.trim() || id.length > 200 || seen.has(id)) continue
    seen.add(id)
    if (typeof m === 'string') {
      out.push({ id })
      continue
    }
    const effort = m.capabilities?.effort
    const declared =
      effort?.supported === true
        ? Object.entries(effort)
            .filter(([k, v]: [string, any]) => k !== 'supported' && v?.supported === true)
            .map(([k]) => k)
        : Array.isArray(m.reasoning_efforts) ? m.reasoning_efforts : undefined
    const efforts = declared ? [...new Set<string>(declared.map(cleanEffort).filter(Boolean))] : undefined
    const name = typeof m.display_name === 'string' ? m.display_name : typeof m.name === 'string' && m.name !== id ? m.name : undefined
    const contextWindow = firstNum(m, CONTEXT_KEYS) ?? num(m.top_provider?.context_length)
    const maxOutput = firstNum(m, OUTPUT_KEYS) ?? num(m.top_provider?.max_completion_tokens)
    out.push({ id, ...(name && { name: name.slice(0, 80) }), ...(contextWindow && { contextWindow }), ...(maxOutput && { maxOutput }), ...(efforts?.length && { efforts }) })
  }
  return out
}

function headersOf(p: AiProfile): Record<string, string> {
  return p.provider === 'anthropic' ? { 'x-api-key': p.apiKey, 'anthropic-version': '2023-06-01' } : p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}
}

const checkUrl = (p: AiProfile) => {
  if (!/^https?:\/\/[^\s]+$/i.test(p.baseUrl)) throw httpError('请先填写接口地址（以 http:// 或 https:// 开头）', 400)
}

/** 读取上游模型列表 */
export async function fetchModels(p: AiProfile, fetcher: typeof fetch = fetch): Promise<ModelInfo[]> {
  checkUrl(p)
  const anthropic = p.provider === 'anthropic'
  const all: ModelInfo[] = []
  let after = ''
  for (let page = 0; page < 5; page++) {
    const base = p.baseUrl.replace(/\/+$/, '')
    const url = anthropic ? `${base.replace(/\/v1$/, '')}/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}` : `${base}/models`
    const res = await fetcher(url, { headers: headersOf(p), redirect: 'error', signal: AbortSignal.timeout(15_000) }).catch((e: any) => {
      throw httpError(`连不上 ${new URL(url).host}：${e?.cause?.code ?? e?.message ?? '网络错误'}`)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let detail = text.slice(0, 200)
      try {
        const d = JSON.parse(text)
        detail = d?.error?.message ?? d?.message ?? detail
      } catch {
        /* 不是 JSON，直接用原文 */
      }
      if (res.status === 401 || res.status === 403) throw httpError(`密钥无效或没有权限（HTTP ${res.status}）：${detail}`)
      if (res.status === 404 || res.status === 405) throw httpError(`这个服务没有提供模型列表接口（HTTP ${res.status}），请手动填写模型名`)
      throw httpError(`读取模型列表失败（HTTP ${res.status}）：${detail}`)
    }
    const json: any = await res.json().catch(() => {
      throw httpError('模型列表不是有效的 JSON，请确认接口地址（通常以 /v1 结尾）')
    })
    all.push(...parseModels(json))
    if (anthropic && json?.has_more && typeof json?.last_id === 'string') after = json.last_id
    else break
  }
  const seen = new Set<string>()
  return all.filter((m) => !seen.has(m.id) && seen.add(m.id))
}

export interface EffortProbe {
  /** 不带思考强度的基本请求是否成功；失败时 baseError 是原因 */
  baseError?: string
  /** 请求被接受的强度 */
  supported: string[]
  /** 被拒绝的强度和服务给的原因 */
  rejected: { effort: string; message: string }[]
  /** 服务连明显无效的强度也接受了：它不校验这个参数，检测结果不可信 */
  ignored: boolean
}

export const OPENAI_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
export const ANTHROPIC_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/**
 * 检测这个模型接受哪些思考强度：每个强度发一条极短的请求，看服务是接受还是报错。
 * 先发一条不带强度的，确认接口本身能用；再发一个明显无效的值，判断服务是不是根本不校验。
 */
export async function probeEfforts(p: AiProfile, send: typeof chatText = chatText): Promise<EffortProbe> {
  // 不带 JSON 模式：被拒绝的强度不必再换一种方式重试一遍，省一半请求
  const probeProfile = { ...p, jsonMode: false }
  const ask = (effort: string) => send('只回答 ok。', '你好', { profile: probeProfile, maxTokens: 64, temperature: 0, effort, keepEffort: true, allowTruncated: true, timeoutMs: 45_000 })
  try {
    await ask('')
  } catch (e: any) {
    return { baseError: e?.message ?? String(e), supported: [], rejected: [], ignored: false }
  }
  let ignored = false
  try {
    await ask('not-a-level')
    ignored = true
  } catch {
    /* 无效值被拒绝：服务会校验这个参数 */
  }
  const supported: string[] = []
  const rejected: EffortProbe['rejected'] = []
  for (const effort of p.provider === 'anthropic' ? ANTHROPIC_EFFORTS : OPENAI_EFFORTS) {
    try {
      await ask(effort)
      supported.push(effort)
    } catch (e: any) {
      rejected.push({ effort, message: String(e?.message ?? e).replace(/^AI 请求失败 \d+: /, '').slice(0, 160) })
    }
  }
  return { supported, rejected, ignored }
}
