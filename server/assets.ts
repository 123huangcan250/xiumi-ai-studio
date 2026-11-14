// 素材库：上传、按需裁切缩放（微信相册统一比例）、裁剪另存。
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { DIRS, readJson, safeId, writeJson } from './store'

export interface Asset {
  id: string
  file: string
  name: string
  width: number
  height: number
  size: number
  createdAt: number
}

const META = join(DIRS.assets, '_index.json')
const MAX_EDGE = 2400

async function index(): Promise<Record<string, Asset>> {
  return readJson(META, {})
}

export async function listAssets(): Promise<Asset[]> {
  return Object.values(await index()).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 动图只存一帧。装饰用的动图常常是“逐渐画出来”的，第一帧完全透明，存下来就是一张空白图：
 * 第一帧几乎全透明时，改取画面最满的一帧。
 */
export async function bestFrame(buf: Buffer): Promise<number> {
  const meta = await sharp(buf, { animated: true }).metadata().catch(() => null)
  const pages = meta?.pages ?? 1
  if (pages < 2) return 0
  const coverage = async (page: number) => (await sharp(buf, { page }).ensureAlpha().stats()).channels[3].mean
  let best = 0
  let most = await coverage(0)
  if (most > 8) return 0
  const step = Math.max(1, Math.ceil(pages / 40))
  for (let i = step; i < pages; i += step) {
    const c = await coverage(i)
    if (c > most + 1) {
      most = c
      best = i
    }
  }
  return best
}

/** 保存上传图片：纠正 EXIF 方向、限制最长边、统一为 jpg/png */
export async function saveAsset(buf: Buffer, name: string): Promise<Asset> {
  const id = nanoid(12).replace(/[^\w-]/g, '_')
  const img = sharp(buf, { animated: false, page: await bestFrame(buf) }).rotate()
  const meta = await img.metadata()
  // 透明的 PNG、GIF、WebP 存成 PNG（GIF 只保留第一帧），其余统一为 JPG
  const keepPng = ['png', 'gif', 'webp'].includes(meta.format ?? '') && !!meta.hasAlpha
  const ext = keepPng ? '.png' : '.jpg'
  const file = `${id}${ext}`
  const pipeline = img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
  const info = await (keepPng ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 86, mozjpeg: true })).toFile(join(DIRS.assets, file))
  const asset: Asset = { id, file, name, width: info.width, height: info.height, size: info.size, createdAt: Date.now() }
  const idx = await index()
  idx[id] = asset
  await writeJson(META, idx)
  return asset
}

export async function deleteAsset(id: string) {
  const idx = await index()
  const a = idx[safeId(id)]
  if (!a) return
  delete idx[id]
  await writeJson(META, idx)
  await rm(join(DIRS.assets, a.file), { force: true })
}

/** 裁剪（像素坐标）后另存为新素材，原图保留 */
export async function cropAsset(id: string, box: { x: number; y: number; width: number; height: number }) {
  const a = (await index())[safeId(id)]
  if (!a) throw Object.assign(new Error('素材不存在'), { status: 404 })
  const r = (n: number) => Math.max(0, Math.round(n))
  const buf = await sharp(join(DIRS.assets, a.file))
    .extract({ left: r(box.x), top: r(box.y), width: Math.min(r(box.width), a.width - r(box.x)), height: Math.min(r(box.height), a.height - r(box.y)) })
    .toBuffer()
  return saveAsset(buf, a.name.replace(/(\.\w+)?$/, '-crop$1'))
}

const FIT_RE = /^(\d{1,3}):(\d{1,3})$/

/**
 * 返回素材的变体文件路径：w = 目标宽度，fit = 宽高比（居中裁切，利用 attention 策略保留主体）
 * 结果缓存到 data/cache。
 */
export async function variantPath(file: string, fit?: string, w?: number): Promise<string> {
  if (!/^[\w-]+\.(jpg|png)$/.test(file)) throw Object.assign(new Error('非法文件名'), { status: 400 })
  const src = join(DIRS.assets, file)
  if (!existsSync(src)) throw Object.assign(new Error('素材不存在'), { status: 404 })
  const width = Math.min(2400, Math.max(64, Number(w) || 1080))
  const m = fit ? fit.match(FIT_RE) : null
  if (!m && width >= 2400) return src
  const key = `${file.replace(/\.\w+$/, '')}_${m ? `${m[1]}x${m[2]}` : 'o'}_${width}${extname(file)}`
  const out = join(DIRS.cache, key)
  if (existsSync(out)) return out
  let img = sharp(src)
  img = m
    ? img.resize({ width, height: Math.round((width * Number(m[2])) / Number(m[1])), fit: 'cover', position: sharp.strategy.attention })
    : img.resize({ width, withoutEnlargement: true })
  await (file.endsWith('.png') ? img.png() : img.jpeg({ quality: 84, mozjpeg: true })).toFile(out)
  return out
}

/** 微信 uploadimg 要求 jpg/png 且 ≤1MB：逐级降低质量与尺寸 */
export async function wechatReady(path: string): Promise<{ buf: Buffer; mime: string; name: string }> {
  const s = await stat(path)
  if (s.size <= 1_000_000) return { buf: await readFile(path), mime: path.endsWith('.png') ? 'image/png' : 'image/jpeg', name: path.split(/[\\/]/).pop()! }
  for (const [q, w] of [[80, 1600], [72, 1280], [65, 1080], [60, 900]] as const) {
    const buf = await sharp(path).flatten({ background: '#ffffff' }).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: q, mozjpeg: true }).toBuffer()
    if (buf.length <= 1_000_000) return { buf, mime: 'image/jpeg', name: 'image.jpg' }
  }
  throw new Error('图片压缩后仍超过 1MB')
}

export async function cleanCache() {
  for (const f of await readdir(DIRS.cache)) await rm(join(DIRS.cache, f), { force: true })
}

/** 编辑回放的文字栅格图：按内容哈希存成 rp-*.png，不进素材列表，相同内容只存一份 */
export async function saveGlyph(dataUrl: string): Promise<string | null> {
  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return null
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length > 2_000_000) return null
  const meta = await sharp(buf).metadata().catch(() => null)
  if (meta?.format !== 'png') return null
  const file = `rp-${createHash('sha1').update(buf).digest('hex').slice(0, 24)}.png`
  const path = join(DIRS.assets, file)
  if (!existsSync(path)) await writeFile(path, buf)
  return file
}
