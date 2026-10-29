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
  hasKey?: boolean
  readonly?: boolean
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
  saveTemplate: (name: string, blocks: Block[]) => req<Template>('POST', '/api/templates', { name, blocks }),
  deleteTemplate: (id: string) => req('DELETE', `/api/templates/${id}`),
  themes: () => req<Theme[]>('GET', '/api/themes'),
  saveTheme: (t: Theme) => req('POST', '/api/themes', t),
  deleteTheme: (id: string) => req('DELETE', `/api/themes/${id}`),

  aiStatus: () => req<AiStatus>('GET', '/api/ai/status'),
  aiSettings: () => req<AiSettings>('GET', '/api/settings/ai'),
  saveAiSettings: (s: { activeId: string; profiles: AiProfile[] }) => req<AiSettings>('PUT', '/api/settings/ai', s),
  testAi: (p: AiProfile) => req<{ ok: boolean; reply: unknown; ms: number }>('POST', '/api/settings/ai/test', p),
  aiOutline: (text: string, imageNames: string[], profileId?: string) => req<any>('POST', '/api/ai/outline', { text, imageNames, profileId }),
  aiDesign: (brief: unknown, hint: string, profileId?: string) => req<{ designs: any[] }>('POST', '/api/ai/design', { brief, hint, profileId }),
  aiEdit: (context: unknown, instruction: string, profileId?: string) => req<{ summary: string; ops: any[] }>('POST', '/api/ai/edit', { context, instruction, profileId }),
  fetchReference: (url: string) => req<{ html: string }>('POST', '/api/reference/fetch', { url }),
  fetchArticle: (url: string) => req<{ html: string }>('POST', '/api/article/fetch', { url }),
  fetchAssets: (urls: string[]) => req<Record<string, Asset>>('POST', '/api/assets/fetch', { urls }),

  wechatStatus: () => req<{ configured: boolean; appid: string }>('GET', '/api/wechat/status'),
  wechatUploadImages: (urls: string[]) => req<Record<string, string>>('POST', '/api/wechat/upload-images', { urls }),
  wechatDraft: (body: { title: string; author: string; digest: string; html: string; cover: string; confirm: true }) =>
    req<{ media_id: string }>('POST', '/api/wechat/draft', body),
}
