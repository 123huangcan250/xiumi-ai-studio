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
}

interface Settings {
  ai: { activeId: string; profiles: AiProfile[] }
}

const FILE = join(DATA, 'settings.json')
const MASK = '••••••'

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
      const key = typeof p.apiKey === 'string' && p.apiKey && !p.apiKey.includes(MASK) ? p.apiKey.trim() : (prev?.apiKey ?? '')
      return {
        id: p.id && /^[\w-]{1,40}$/.test(p.id) ? p.id : nanoid(8).replace(/[^\w]/g, 'x'),
        name: String(p.name ?? '未命名模型').slice(0, 40),
        provider: p.provider === 'anthropic' ? 'anthropic' : 'openai',
        baseUrl: String(p.baseUrl ?? '').trim().replace(/\/+$/, ''),
        apiKey: key,
        model: String(p.model ?? '').trim(),
        jsonMode: p.jsonMode !== false,
      }
    })
  s.ai = { activeId: String(input.activeId ?? ''), profiles }
  await writeJson(FILE, s)
  return publicAiSettings()
}

/** 测试用：未保存的配置（密钥打码时取已保存的） */
export async function resolveDraftProfile(p: Partial<AiProfile>): Promise<AiProfile> {
  const saved = p.id ? (await allProfiles()).find((x) => x.id === p.id) : undefined
  const key = typeof p.apiKey === 'string' && p.apiKey && !p.apiKey.includes(MASK) ? p.apiKey.trim() : (saved?.apiKey ?? '')
  return {
    id: p.id ?? 'draft',
    name: p.name ?? '',
    provider: p.provider === 'anthropic' ? 'anthropic' : 'openai',
    baseUrl: String(p.baseUrl ?? saved?.baseUrl ?? '').replace(/\/+$/, ''),
    apiKey: key,
    model: String(p.model ?? saved?.model ?? ''),
    jsonMode: p.jsonMode !== false,
  }
}
