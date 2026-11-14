import { MAX_INPUT_PIXELS, withImageBudget } from './imageBudget'
// 素材库：上传、按需裁切缩放（微信相册统一比例）、裁剪另存。
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { nanoid } from 'nanoid'
import sharp from 'sharp'
import { DIRS, readJson, safeId, mutateJson } from './store'

export interface Asset {
  id: string
  file: string
  name: string
  width: number
  height: number
  size: number
  createdAt: number
  /** Digest of canonical import URL, never the credential-bearing URL itself. */
  sourceKey?: string
}

const META = join(DIRS.assets, '_index.json')
const MAX_EDGE = 2400

function updateIndex(update: (idx: Record<string, Asset>) => void | Promise<void>): Promise<void> {
  return mutateJson<Record<string, Asset>>(META, {}, update)
}

async function index(): Promise<Record<string, Asset>> {
  return readJson(META, {})
}

export async function listAssets(): Promise<Asset[]> {
  return Object.values(await index()).sort((a, b) => b.createdAt - a.createdAt)
}

export function bestFrame(buf: Buffer): Promise<number> { return withImageBudget(() => bestFrameWithinBudget(buf)) }

async function bestFrameWithinBudget(buf: Buffer): Promise<number> {
  const meta = await sharp(buf, { animated: true, limitInputPixels: MAX_INPUT_PIXELS }).metadata().catch(error => { if (error instanceof Error && error.message.includes('Input image exceeds pixel limit')) throw error; return null })
  const pages = meta?.pages ?? 1
  if (pages < 2) return 0
  const coverage = async (page: number) => (await sharp(buf, { page, limitInputPixels: MAX_INPUT_PIXELS }).ensureAlpha().stats()).channels[3].mean
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
export async function saveAsset(buf: Buffer, name: string, sourceKey?: string): Promise<Asset> {
  return withImageBudget(async () => {
    const id = nanoid(12).replace(/[^\w-]/g, '_')
    const img = sharp(buf, { animated: false, page: await bestFrameWithinBudget(buf), limitInputPixels: MAX_INPUT_PIXELS }).rotate()
    const meta = await img.metadata()
    // 透明的 PNG、GIF、WebP 存成 PNG（GIF 保留上游选出的最完整帧），其余统一为 JPG
    const keepPng = ['png', 'gif', 'webp'].includes(meta.format ?? '') && !!meta.hasAlpha
    const ext = keepPng ? '.png' : '.jpg'
    const file = `${id}${ext}`
    const pipeline = img.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    try {
    const info = await (keepPng ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: 86, mozjpeg: true })).toFile(join(DIRS.assets, file))
    const asset: Asset = { id, file, name, width: info.width, height: info.height, size: info.size, createdAt: Date.now(), ...(sourceKey ? { sourceKey } : {}) }
    await updateIndex(idx => { idx[id] = asset })
    return asset
    } catch (error) {
      try { await rm(join(DIRS.assets, file), { force: true }) }
      catch {
        if (error instanceof Error) Object.assign(error, { cleanupFailures: 1 })
        console.warn('Image output cleanup failed for a newly created asset')
      }
      throw error
    }
  })
}

export async function deleteAsset(id: string) {
  safeId(id)
  await updateIndex(async idx => {
    const a = idx[id]
    if (!a) return
    await rm(join(DIRS.assets, a.file), { force: true })
    delete idx[id]
  })
}

/** 裁剪（像素坐标）后另存为新素材，原图保留 */
export async function cropAsset(id: string, box: { x: number; y: number; width: number; height: number }) {
  const a = (await index())[safeId(id)]
  if (!a) throw Object.assign(new Error('素材不存在'), { status: 404 })
  const r = (n: number) => Math.max(0, Math.round(n))
  const buf = await withImageBudget(() => sharp(join(DIRS.assets, a.file), { limitInputPixels: MAX_INPUT_PIXELS })
    .extract({ left: r(box.x), top: r(box.y), width: Math.min(r(box.width), a.width - r(box.x)), height: Math.min(r(box.height), a.height - r(box.y)) })
    .toBuffer())
  return saveAsset(buf, a.name.replace(/(\.\w+)?$/, '-crop$1'))
}

const MAX_VARIANT_PIXELS = 64_000_000
const FIT_RE = /^(\d{1,3}):(\d{1,3})$/

/**
 * 返回素材的变体文件路径：w = 目标宽度，fit = 宽高比（居中裁切，利用 attention 策略保留主体）
 * 结果缓存到 data/cache。
 */
export async function variantPath(file: string, fit?: string, w?: number): Promise<string> {
  if (!/^[\w-]+\.(jpg|png)$/.test(file)) throw Object.assign(new Error('非法文件名'), { status: 400 })
  const src = join(DIRS.assets, file)
  if (!existsSync(src)) throw Object.assign(new Error('素材不存在'), { status: 404 })
  const width = Math.round(Math.min(2400, Math.max(64, Number(w) || 1080)))
  const m = fit ? fit.match(FIT_RE) : null
  const height = m ? Math.round((width * Number(m[2])) / Number(m[1])) : undefined
  if (height !== undefined) {
    if (!Number.isSafeInteger(height) || height < 1) throw Object.assign(new Error('Image aspect ratio must produce a positive integer height.'), { status: 400 })
    if (width * height > MAX_VARIANT_PIXELS) throw Object.assign(new Error('Image variant exceeds the 64-megapixel output limit. Reduce its width or choose a less extreme aspect ratio.'), { status: 413 })
  }
  if (!m && width >= 2400) return src
  const key = `${file.replace(/\.\w+$/, '')}_${m ? `${m[1]}x${m[2]}` : 'o'}_${width}${extname(file)}`
  const out = join(DIRS.cache, key)
  if (existsSync(out)) return out
  await withImageBudget(async () => {
    if (existsSync(out)) return // Another queued request may have completed this exact variant.
    let img = sharp(src, { limitInputPixels: MAX_INPUT_PIXELS })
    img = m
      ? img.resize({ width, height, fit: 'cover', position: sharp.strategy.attention })
      : img.resize({ width, withoutEnlargement: true })
    const temporary = join(DIRS.cache, `.${key}.${nanoid()}.tmp`)
    try {
      await (file.endsWith('.png') ? img.png() : img.jpeg({ quality: 84, mozjpeg: true })).toFile(temporary)
      await rename(temporary, out)
    } catch (error) {
      try { await rm(temporary, { force: true }) }
      catch {
        if (error instanceof Error) Object.assign(error, { cleanupFailures: 1 })
        console.warn('Image variant cleanup failed for a newly created output')
      }
      throw error
    }
  })
  return out
}

/** 微信 uploadimg 要求 jpg/png 且 ≤1MB：逐级降低质量与尺寸 */
export async function wechatReady(path: string): Promise<{ buf: Buffer; mime: string; name: string }> {
  const s = await stat(path)
  if (s.size <= 1_000_000) return { buf: await readFile(path), mime: path.endsWith('.png') ? 'image/png' : 'image/jpeg', name: path.split(/[\\/]/).pop()! }
  for (const [q, w] of [[80, 1600], [72, 1280], [65, 1080], [60, 900]] as const) {
    const buf = await withImageBudget(() => sharp(path, { limitInputPixels: MAX_INPUT_PIXELS }).flatten({ background: '#ffffff' }).resize({ width: w, withoutEnlargement: true }).jpeg({ quality: q, mozjpeg: true }).toBuffer())
    if (buf.length <= 1_000_000) return { buf, mime: 'image/jpeg', name: 'image.jpg' }
  }
  throw new Error('图片压缩后仍超过 1MB')
}

export async function cleanCache() {
  for (const f of await readdir(DIRS.cache)) await rm(join(DIRS.cache, f), { force: true })
}

export function saveGlyph(dataUrl: string): Promise<string | null> {
  return withImageBudget(async () => {
  const m = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/)
  if (!m) return null
  const buf = Buffer.from(m[1], 'base64')
  if (buf.length > 2_000_000) return null
  const meta = await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS }).metadata().catch(() => null)
  if (meta?.format !== 'png') return null
  const file = `rp-${createHash('sha1').update(buf).digest('hex').slice(0, 24)}.png`
  const path = join(DIRS.assets, file)
  if (!existsSync(path)) {
    const temporary = join(DIRS.assets, `.${file}.${nanoid()}.tmp`)
    try { await writeFile(temporary, buf, { flag: 'wx' }); await rename(temporary, path) }
    catch (error) {
      try { await rm(temporary, { force: true }) }
      catch { if (error instanceof Error) Object.assign(error, { cleanupFailures: 1 }); console.warn('Managed glyph cleanup failed for a newly created output') }
      throw error
    }
  }
  return file
  })
}
