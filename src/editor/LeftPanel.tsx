import { useDraggable } from '@dnd-kit/core'
import { useCallback, useEffect, useState } from 'react'
import { BLOCK_TYPES, blockMeta, cloneBlock, createBlock } from '../core/blocks'
import type { BlockType } from '../core/types'
import { api, assetRef, type Asset, type ProjectSummary, type Template } from './api'
import { CropModal } from './CropModal'
import { emptyDoc, saveNow, selectedBlock, useStore } from './store'

type Tab = 'blocks' | 'assets' | 'templates' | 'projects'

function LibItem({ type }: { type: BlockType }) {
  const m = blockMeta(type)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `lib:${type}` })
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`lib-item ${isDragging ? 'dragging' : ''}`}
      onClick={() => useStore.getState().insertBlock(type)}
      title="点击插入到选中模块之后，或拖入画布"
      data-testid={`lib-${type}`}
    >
      <span className="lib-icon">{m.icon}</span>
      <span>{m.label}</span>
    </button>
  )
}

/** 选中图片类模块时，点击素材即替换/追加；否则插入单图模块 */
export function useAssetToDoc() {
  return useCallback((a: Asset) => {
    const s = useStore.getState()
    const b = selectedBlock(s)
    const ref = assetRef(a)
    if (b && b.type === 'gallery') s.updateProps(b.id, { images: [...b.props.images, ref] })
    else if (b && ['image', 'imageText', 'profile', 'cover', 'ending'].includes(b.type)) s.updateProps(b.id, { image: ref })
    else s.insertBlock(createBlock('image', { image: ref }))
  }, [])
}

function AssetThumb({ a, onCrop, onDelete }: { a: Asset; onCrop: () => void; onDelete: () => void }) {
  const toDoc = useAssetToDoc()
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `asset:${a.id}`, data: { asset: a } })
  return (
    <div className="asset" ref={setNodeRef} {...listeners} {...attributes}>
      <img src={`/media/${a.file}?fit=1:1&w=240`} alt={a.name} onClick={() => toDoc(a)} title={`${a.name} ${a.width}×${a.height}\n点击：插入或替换选中模块的图片`} />
      <div className="asset-actions">
        <button onClick={onCrop} title="裁剪">裁剪</button>
        <button onClick={onDelete} title="删除" className="danger">删除</button>
      </div>
    </div>
  )
}

export function LeftPanel() {
  const [tab, setTab] = useState<Tab>('blocks')
  const [assets, setAssets] = useState<Asset[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [cropping, setCropping] = useState<Asset | null>(null)
  const [busy, setBusy] = useState(false)
  const { notify, insertBlocks, load } = useStore.getState()
  const docId = useStore((s) => s.doc.id)

  const refreshAssets = useCallback(() => api.assets().then(setAssets).catch(() => {}), [])
  const refreshTemplates = useCallback(() => api.templates().then(setTemplates).catch(() => {}), [])
  const refreshProjects = useCallback(() => api.projects().then(setProjects).catch(() => {}), [])

  useEffect(() => {
    refreshAssets()
    refreshTemplates()
    const r = () => refreshAssets()
    const t = () => refreshTemplates()
    window.addEventListener('assets-changed', r)
    window.addEventListener('templates-changed', t)
    return () => {
      window.removeEventListener('assets-changed', r)
      window.removeEventListener('templates-changed', t)
    }
  }, [refreshAssets, refreshTemplates])
  useEffect(() => {
    if (tab === 'projects') refreshProjects()
  }, [tab, refreshProjects, docId])

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    try {
      await api.uploadAssets(files)
      await refreshAssets()
      notify(`已上传 ${files.length} 张图片`)
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const groups = ['结构', '文字', '图片', '信息'] as const
  return (
    <aside className="panel left">
      <nav className="tabs">
        {(['blocks', 'assets', 'templates', 'projects'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {{ blocks: '模块', assets: '素材', templates: '模板', projects: '项目' }[t]}
          </button>
        ))}
      </nav>
      <div className="panel-body">
        {tab === 'blocks' &&
          groups.map((g) => (
            <section key={g}>
              <h4>{g}</h4>
              <div className="lib-grid">
                {BLOCK_TYPES.filter((t) => blockMeta(t).group === g).map((t) => (
                  <LibItem key={t} type={t} />
                ))}
              </div>
            </section>
          ))}

        {tab === 'assets' && (
          <>
            <label className="upload">
              <input type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} data-testid="asset-upload" />
              {busy ? '上传中…' : '＋ 上传图片（可多选）'}
            </label>
            <p className="hint">点击图片插入；选中相册/单图/图文等模块时点击即替换。也可拖到模块上。图片会自动纠正方向并压缩。</p>
            <div className="asset-grid">
              {assets.map((a) => (
                <AssetThumb
                  key={a.id}
                  a={a}
                  onCrop={() => setCropping(a)}
                  onDelete={async () => {
                    if (!confirm(`从素材库删除「${a.name}」？已使用该图片的模块将无法显示。`)) return
                    await api.deleteAsset(a.id)
                    refreshAssets()
                  }}
                />
              ))}
            </div>
            {!assets.length && <p className="empty">暂无素材</p>}
          </>
        )}

        {tab === 'templates' && (
          <>
            <button
              className="wide"
              onClick={async () => {
                const doc = useStore.getState().doc
                const name = prompt('把当前整篇结构收藏为模板，名称：', doc.title)
                if (!name) return
                await api.saveTemplate(name, doc.blocks, doc)
                refreshTemplates()
                notify('已收藏整篇模板')
              }}
            >
              ☆ 收藏当前整篇为模板
            </button>
            <p className="hint">在画布中选中模块后点击 ☆ 可收藏单个模块。点击模板插入到选中位置之后；「套用」保留模板版式，换上新文稿和照片。</p>
            {templates.map((t) => (
              <div key={t.id} className="tpl-item">
                <button className="grow" onClick={() => insertBlocks(t.blocks)} title="插入到当前文档选中位置之后" data-testid="template-item">
                  <b>{t.name}</b>
                  <small>{t.blocks.length} 个模块 · {t.blocks.slice(0, 4).map((b) => (b.type === 'html' ? b.props.label : blockMeta(b.type).label)).join(' / ')}</small>
                </button>
                <div className="tpl-actions">
                  <button
                    className="accent"
                    title="保留此模板的版式，换上新文稿和照片（可由 AI 撰写文案）"
                    onClick={() => window.dispatchEvent(new CustomEvent('open-import', { detail: { templateIds: [t.id] } }))}
                    data-testid="apply-template"
                  >
                    套用
                  </button>
                  <button
                    title="用此模板新建项目"
                    onClick={async () => {
                      await saveNow()
                      const now = Date.now()
                      load({ ...emptyDoc(), title: t.name, ...(t.themeId && { themeId: t.themeId, themeOverrides: t.themeOverrides }), blocks: t.blocks.map(cloneBlock), createdAt: now, updatedAt: now })
                      await saveNow()
                      notify(`已用模板「${t.name}」新建项目`)
                    }}
                  >
                    新建
                  </button>
                  <button
                    className="danger"
                    onClick={async () => {
                      if (!confirm(`删除模板「${t.name}」？`)) return
                      await api.deleteTemplate(t.id)
                      refreshTemplates()
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {!templates.length && <p className="empty">还没有收藏的模板</p>}
          </>
        )}

        {tab === 'projects' && (
          <>
            <button
              className="wide"
              onClick={async () => {
                await saveNow()
                load(emptyDoc())
                await saveNow()
                refreshProjects()
              }}
            >
              ＋ 新建空白项目
            </button>
            {projects.map((p) => (
              <div key={p.id} className={`list-row ${p.id === docId ? 'current' : ''}`}>
                <button
                  className="grow"
                  onClick={async () => {
                    await saveNow()
                    load(await api.project(p.id))
                  }}
                >
                  <b>{p.title || '未命名'}</b>
                  <small>{new Date(p.updatedAt).toLocaleString()} · {p.blockCount} 个模块</small>
                </button>
                <button
                  className="danger"
                  disabled={p.id === docId}
                  title={p.id === docId ? '不能删除正在编辑的项目' : '删除项目'}
                  onClick={async () => {
                    if (!confirm(`删除项目「${p.title}」？此操作不可撤销。`)) return
                    await api.deleteProject(p.id)
                    refreshProjects()
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </>
        )}
      </div>
      {cropping && (
        <CropModal
          asset={cropping}
          onClose={() => setCropping(null)}
          onDone={() => {
            setCropping(null)
            refreshAssets()
          }}
        />
      )}
    </aside>
  )
}
