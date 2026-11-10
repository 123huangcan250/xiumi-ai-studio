// 本机设置：AI 模型配置（可保存多套，选一套为当前使用）。
// 密钥只保存在本机 data/settings.json，接口返回时打码，浏览器拿不到完整密钥。
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import { DATA, readJson, writeJson } from './store'

export interface AiProfile {
  id: string
  name: string
  /** openai = OpenAI 兼容 Chat Completions；anthropic = Claude Messages API */
  provider: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  model: string
  /** 是否请求 response_format=json_object（部分服务不支持，失败时会自动重试不带该参数） */
  jsonMode: boolean
  /** 思考强度（reasoning_effort / output_config.effort）；空 = 不发送，用模型默认值 */
  reasoningEffort?: string
  /** 检测或上游返回的、这个模型接受的思考强度 */
  efforts?: string[]
  /** 上下文窗口（token，0 = 未知），来自上游模型列表，可手动改 */
  contextWindow?: number
  /** 单次最大输出（token，0 = 未知）：请求的 max_tokens 不会超过它 */
  maxOutputTokens?: number
  /** 额外的请求参数（JSON 对象），合并进请求体，给第三方接口的特殊开关用 */
  extraBody?: string
}

/** 思考强度只接受字母、数字、下划线和短横线，不信任前端传来的任意字符串 */
const EFFORT = /^[a-zA-Z0-9_-]{1,40}$/
export const cleanEffort = (v: unknown): string => {
  if (typeof v !== 'string' || !EFFORT.test(v.trim())) return ''
  const value = v.trim()
  return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.toLowerCase()) ? value.toLowerCase() : value
}
const cleanCount = (v: unknown) => {
  const n = Math.floor(Number(v))
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000_000) : 0
}
/** 额外参数必须是 JSON 对象；不是就丢弃（保存时界面会提示） */
export function cleanExtraBody(v: unknown): string {
  if (typeof v !== 'string' || !v.trim()) return ''
  try {
    const o = JSON.parse(v)
    return o && typeof o === 'object' && !Array.isArray(o) ? JSON.stringify(o) : ''
  } catch {
    return ''
  }
}
/** 公共的新字段整理（保存和临时测试共用） */
function tuning(p: Partial<AiProfile>, fallback?: AiProfile): Pick<AiProfile, 'reasoningEffort' | 'efforts' | 'contextWindow' | 'maxOutputTokens' | 'extraBody'> {
  const efforts = Array.isArray(p.efforts) ? [...new Set(p.efforts.map(cleanEffort).filter(Boolean))].slice(0, 10) : (fallback?.efforts ?? [])
  return {
    reasoningEffort: cleanEffort(p.reasoningEffort ?? fallback?.reasoningEffort),
    efforts,
    contextWindow: cleanCount(p.contextWindow ?? fallback?.contextWindow),
    maxOutputTokens: cleanCount(p.maxOutputTokens ?? fallback?.maxOutputTokens),
    extraBody: cleanExtraBody(p.extraBody ?? fallback?.extraBody),
  }
}

interface Settings {
  ai: { activeId: string; profiles: AiProfile[] }
}

const FILE = join(DATA, 'settings.json')

const MASK = '••••••'

function draftKey(p: Partial<AiProfile>, saved?: AiProfile): string {
  if (typeof p.apiKey === 'string' && p.apiKey.trim() && !p.apiKey.includes(MASK)) return p.apiKey.trim()
  if (saved?.apiKey) {
    let sameOrigin = false
    try { sameOrigin = new URL(p.baseUrl ?? saved.baseUrl).origin === new URL(saved.baseUrl).origin } catch { /* invalid URL */ }
    if (!sameOrigin || (p.provider ?? saved.provider) !== saved.provider) {
      throw Object.assign(new Error('更换服务商地址或接口类型后，请重新输入 API Key'), { status: 400 })
    }
  }
  return saved?.apiKey ?? ''
}

async function load(): Promise<Settings> {
  const s = await readJson<Settings>(FILE, { ai: { activeId: '', profiles: [] } })
  s.ai ??= { activeId: '', profiles: [] }
  return s
}

/** .env 中的配置作为只读的一套 */
function envProfile(): AiProfile | null {
  const key = process.env.AI_API_KEY
  if (!key) return null
  const provider = process.env.AI_PROVIDER === 'anthropic' ? 'anthropic' : 'openai'
  return {
    id: 'env',
    name: '.env 配置',
    provider,
    baseUrl: process.env.AI_BASE_URL ?? (provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.deepseek.com/v1'),
    apiKey: key,
    model: process.env.AI_MODEL ?? '',
    jsonMode: true,
  }
}

export async function allProfiles(): Promise<AiProfile[]> {
  const env = envProfile()
  return [...(env ? [env] : []), ...(await load()).ai.profiles]
}

export async function getProfile(id?: string): Promise<AiProfile | null> {
  const list = await allProfiles()
  const s = await load()
  return list.find((p) => p.id === (id || s.ai.activeId)) ?? list[0] ?? null
}

const maskKey = (k: string) => (k ? `${k.slice(0, 3)}${MASK}${k.slice(-4)}` : '')

export async function publicAiSettings() {
  const s = await load()
  const list = await allProfiles()
  const active = list.find((p) => p.id === s.ai.activeId) ?? list[0]
  return {
    activeId: active?.id ?? '',
    profiles: list.map((p) => ({ ...p, apiKey: maskKey(p.apiKey), hasKey: Boolean(p.apiKey), readonly: p.id === 'env' })),
  }
}

/** 保存配置；密钥字段为空或仍是打码值时保留原密钥 */
export async function saveAiSettings(input: { activeId: string; profiles: Partial<AiProfile>[] }) {
  const s = await load()
  const old = new Map(s.ai.profiles.map((p) => [p.id, p]))
  const profiles: AiProfile[] = (input.profiles ?? [])
    .filter((p) => p.id !== 'env')
    .map((p) => {
      const prev = p.id ? old.get(p.id) : undefined
      const key = draftKey({ ...p, provider: p.provider === 'anthropic' ? 'anthropic' : 'openai', baseUrl: String(p.baseUrl ?? '').trim() }, prev)
      return {
        id: p.id && /^[\w-]{1,40}$/.test(p.id) ? p.id : nanoid(8).replace(/[^\w]/g, 'x'),
        name: String(p.name ?? '未命名模型').slice(0, 40),
        provider: p.provider === 'anthropic' ? 'anthropic' : 'openai',
        baseUrl: String(p.baseUrl ?? '').trim().replace(/\/+$/, ''),
        apiKey: key,
        model: String(p.model ?? '').trim(),
        jsonMode: p.jsonMode !== false,
        ...tuning(p),
      }
    })
  s.ai = { activeId: String(input.activeId ?? ''), profiles }
  await writeJson(FILE, s)
  return publicAiSettings()
}

/** 测试用：未保存的配置（密钥打码时取已保存的） */
export async function resolveDraftProfile(p: Partial<AiProfile>): Promise<AiProfile> {
  const saved = p.id ? (await allProfiles()).find((x) => x.id === p.id) : undefined
  const provider = (p.provider ?? saved?.provider) === 'anthropic' ? 'anthropic' : 'openai'
  const key = draftKey({ ...p, provider }, saved)
  const sameModel = saved && (p.model ?? saved.model) === saved.model && (p.baseUrl ?? saved.baseUrl) === saved.baseUrl && provider === saved.provider
  return {
    id: p.id ?? 'draft',
    name: p.name ?? '',
    provider,
    baseUrl: String(p.baseUrl ?? saved?.baseUrl ?? '').replace(/\/+$/, ''),
    apiKey: key,
    model: String(p.model ?? saved?.model ?? ''),
    jsonMode: p.jsonMode !== false,
    ...tuning(p, sameModel ? saved : undefined),
  }
}
