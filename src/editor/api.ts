import type { ComponentDraft, LibraryComponent } from '../core/components'
import type { RoleId } from '../core/roles'
import type { Block, Doc, ImageRef, Theme } from '../core/types'

export interface Asset {
  id: string
  file: string
  name: string
  width: number
  height: number
  size: number
  createdAt: number
}
export interface ProjectSummary {
  id: string
  title: string
  updatedAt: number
  themeId: string
  blockCount: number
}
export interface VersionSummary {
  id: string
  label: string
  createdAt: number
  blockCount: number
}
export interface AiProfile {
  id: string
  name: string
  provider: 'openai' | 'anthropic'
  baseUrl: string
  apiKey: string
  model: string
  jsonMode: boolean
  /** 思考强度；空 = 不发送，用模型默认值 */
  reasoningEffort?: string
  /** 检测或上游返回的、这个模型接受的思考强度 */
  efforts?: string[]
  /** 上下文窗口（token，0 = 未知） */
  contextWindow?: number
  /** 单次最大输出（token，0 = 未知） */
  maxOutputTokens?: number
  /** 额外的请求参数（JSON 对象） */
  extraBody?: string
  hasKey?: boolean
  readonly?: boolean
}
export interface ModelInfo {
  id: string
  name?: string
  contextWindow?: number
  maxOutput?: number
  efforts?: string[]
  reasoningEfforts?: string[]
}
export interface EffortProbe {
  baseError?: string
  supported: string[]
  rejected: { effort: string; message: string }[]
  ignored: boolean
}
export interface AiSettings {
  activeId: string
  profiles: AiProfile[]
}
export interface AiStatus {
  enabled: boolean
  provider: string
  model: string
  name: string
  profileId: string
}
export interface Template {
  id: string
  name: string
  blocks: Block[]
  themeId?: string
  themeOverrides?: Doc['themeOverrides']
  /** 模块 id → 标准名称（用户确认过的）；没有时套用前自动识别 */
  roles?: Record<string, RoleId>
  createdAt: number
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'content-type': 'application/json' }
  }
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`)
  return data as T
}

export const assetRef = (a: Asset): ImageRef => ({ src: `/media/${a.file}`, assetId: a.id, alt: a.name, width: a.width, height: a.height })

export const api = {
  assets: () => req<Asset[]>('GET', '/api/assets'),
  uploadAssets(files: File[] | FileList) {
    const fd = new FormData()
    for (const f of Array.from(files)) fd.append('files', f)
    return req<Asset[]>('POST', '/api/assets', fd)
  },
  cropAsset: (id: string, box: { x: number; y: number; width: number; height: number }) => req<Asset>('POST', `/api/assets/${id}/crop`, box),
  deleteAsset: (id: string) => req('DELETE', `/api/assets/${id}`),
  importFile(file: File) {
    const fd = new FormData()
    fd.append('file', file)
    return req<{ text: string; assets: Asset[] }>('POST', '/api/import', fd)
  },
  loadSample: () => req<{ text: string; assets: Asset[] }>('POST', '/api/samples/load'),

  projects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  project: (id: string) => req<Doc>('GET', `/api/projects/${id}`),
  saveProject: (doc: Doc) => req<{ updatedAt: number }>('PUT', `/api/projects/${doc.id}`, doc),
  deleteProject: (id: string) => req('DELETE', `/api/projects/${id}`),
  versions: (id: string) => req<VersionSummary[]>('GET', `/api/projects/${id}/versions`),
  saveVersion: (doc: Doc, label: string) => req<VersionSummary>('POST', `/api/projects/${doc.id}/versions`, { doc, label }),
  version: (pid: string, vid: string) => req<{ doc: Doc }>('GET', `/api/projects/${pid}/versions/${vid}`),

  templates: () => req<Template[]>('GET', '/api/templates'),
  saveTemplate: (name: string, blocks: Block[], theme?: Pick<Doc, 'themeId' | 'themeOverrides'>) =>
    req<Template>('POST', '/api/templates', { name, blocks, themeId: theme?.themeId, themeOverrides: theme?.themeOverrides }),
  deleteTemplate: (id: string) => req('DELETE', `/api/templates/${id}`),
  updateTemplate: (id: string, patch: { name?: string; roles?: Record<string, RoleId> }) => req<Template>('PUT', `/api/templates/${id}`, patch),
  components: () => req<LibraryComponent[]>('GET', '/api/components'),
  saveComponent: (draft: ComponentDraft) => req<{ component: LibraryComponent; duplicate: boolean }>('POST', '/api/components', draft),
  updateComponent: (id: string, patch: { name?: string; tags?: string[]; kind?: string; role?: RoleId }) => req<LibraryComponent>('PUT', `/api/components/${id}`, patch),
  deleteComponent: (id: string) => req('DELETE', `/api/components/${id}`),
  themes: () => req<Theme[]>('GET', '/api/themes'),
  saveTheme: (t: Theme) => req('POST', '/api/themes', t),
  deleteTheme: (id: string) => req('DELETE', `/api/themes/${id}`),

  aiStatus: () => req<AiStatus>('GET', '/api/ai/status'),
  aiSettings: () => req<AiSettings>('GET', '/api/settings/ai'),
  saveAiSettings: (s: { activeId: string; profiles: AiProfile[] }) => req<AiSettings>('PUT', '/api/settings/ai', s),
  testAi: (p: AiProfile) => req<{ ok: boolean; reply: unknown; ms: number }>('POST', '/api/settings/ai/test', p),
  aiModels: async (p: AiProfile): Promise<ModelInfo[]> => {
    const r = await req<ModelInfo[] | { models: ModelInfo[] }>('POST', '/api/settings/ai/models', p)
    const models = Array.isArray(r) ? r : r?.models
    if (!Array.isArray(models)) throw new Error('服务未返回有效的模型列表')
    return models
  },
  probeEffort: (p: AiProfile) => req<EffortProbe>('POST', '/api/settings/ai/probe-effort', p),
  aiOutline: (text: string, imageNames: string[], imageNotes: string[] = [], profileId?: string) => req<any>('POST', '/api/ai/outline', { text, imageNames, imageNotes, profileId }),
  aiDesign: (brief: unknown, hint: string, profileId?: string) => req<{ designs: any[] }>('POST', '/api/ai/design', { brief, hint, profileId }),
  aiCopywrite: (body: { brief: string; style: string; length: string; levels: number; extra: string; previous?: string; revise?: string; profileId?: string }) => req<{ markdown?: string }>('POST', '/api/ai/copywrite', body),
  aiEnrichCopy: (body: { text: string; photos: unknown[]; keep: string[]; profileId?: string }) => req<{ markdown?: string; changes?: string[] }>('POST', '/api/ai/enrich-copy', body),
  aiPlacePhotos: (body: unknown) => req<{ placements?: unknown[] }>('POST', '/api/ai/place-photos', body),
  aiSuggestInstruction: (context: unknown, profileId?: string, selectedId?: string) => req<{ suggestion: string }>('POST', '/api/ai/suggest-instruction', { context, profileId, selectedId }),
  aiEdit: (context: unknown, instruction: string, profileId?: string, selectedId?: string) => req<{ summary: string; ops: any[] }>('POST', '/api/ai/edit', { context, instruction, profileId, selectedId }),
  fetchReference: (url: string) => req<{ html: string }>('POST', '/api/reference/fetch', { url }),
  fetchArticle: (url: string) => req<{ html: string }>('POST', '/api/article/fetch', { url }),
  fetchAssets: (urls: string[]) => req<Record<string, Asset>>('POST', '/api/assets/fetch', { urls }),

  wechatStatus: () => req<{ configured: boolean; appid: string }>('GET', '/api/wechat/status'),
  wechatUploadImages: (urls: string[]) => req<Record<string, string>>('POST', '/api/wechat/upload-images', { urls }),
  wechatDraft: (body: { title: string; author: string; digest: string; html: string; cover: string; confirm: true }) =>
    req<{ media_id: string }>('POST', '/api/wechat/draft', body),
}
