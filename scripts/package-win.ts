// Windows x64 打包：生成便携文件夹 release/XIUMI-AI-Studio-<版本>-win-x64/ 和同名 zip。
//
//   pnpm package:win
//
// 产物结构：
//   XIUMI AI Studio.exe   Node.js 运行时（固定版本，校验 SHA-256）+ 启动脚本（Node 单文件应用 SEA）
//   使用说明.txt / THIRD_PARTY_NOTICES.md
//   app/server.cjs        服务端（esbuild 打包，含全部 JS 依赖）
//   app/dist/             前端
//   app/samples/          验收样例
//   app/node_modules/     Sharp 原生库与 DOMPurify/jsdom 的常规运行时依赖闭包
//   app/licenses/         Node.js 与全部生产依赖的许可文本
//
// 需要：Windows x64、已执行 pnpm install。首次运行会下载 Node.js 运行时到 .cache/（之后离线可用）。
import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { build } from 'esbuild'
import { unzipSync, Zip, ZipDeflate } from 'fflate'
import { rcedit } from 'rcedit'
import sharp from 'sharp'
import { copyDir } from './fsutil'
import { copyRuntimeDependencies } from './runtimeDependencies'

const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const VERSION: string = pkg.version

/** 内置的 Node.js 运行时。升级时同时修改版本号和官方 SHASUMS256.txt 中 win-x64.zip 的校验值 */
const NODE_VERSION = '22.19.0'
const NODE_SHA256 = 'ea3fad0e67a991d8477d8c01344b56e69c676ccb733f065b22436994b1253f86'
const NODE_MIRRORS = ['https://nodejs.org/dist', 'https://registry.npmmirror.com/-/binary/node']
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

const NAME = `XIUMI-AI-Studio-${VERSION}-win-x64`
const RELEASE = join(ROOT, 'release')
const OUT = join(RELEASE, NAME)
const APP = join(OUT, 'app')
const EXE = join(OUT, 'XIUMI AI Studio.exe')
const WORK = join(ROOT, '.cache', 'package-work')

const step = (msg: string) => console.log(`\n▶ ${msg}`)
const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.error('请在 Windows x64 上打包（sharp 的原生库取自本机安装）')
  process.exit(1)
}

// ---------- 1. 前端 ----------
step('构建前端（vite build）')
execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' })

rmSync(OUT, { recursive: true, force: true })
rmSync(`${OUT}.zip`, { force: true })
rmSync(WORK, { recursive: true, force: true })
mkdirSync(APP, { recursive: true })
mkdirSync(WORK, { recursive: true })

// ---------- 2. 服务端 ----------
step('打包服务端（esbuild → app/server.cjs）')
const result = await build({
  entryPoints: [join(ROOT, 'server', 'launcher.ts')],
  outfile: join(APP, 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Native sharp and jsdom resources require their ordinary runtime package layout.
  external: ['sharp', 'isomorphic-dompurify'],
  define: { 'import.meta.dirname': '__dirname', __XIUMI_VERSION__: JSON.stringify(VERSION) },
  legalComments: 'none',
  logLevel: 'warning',
})
if (result.errors.length) process.exit(1)

// ---------- 3. 资源 ----------
step('复制前端、样例与说明')
copyDir(join(ROOT, 'dist'), join(APP, 'dist'))
copyDir(join(ROOT, 'samples'), join(APP, 'samples'))
// 记事本用 UTF-8 BOM 识别中文
writeFileSync(join(OUT, '使用说明.txt'), `${String.fromCharCode(0xfeff)}${readFileSync(join(ROOT, 'packaging', '使用说明.txt'), 'utf8').replaceAll('{{VERSION}}', VERSION).replace(/\r?\n/g, '\r\n')}`)
copyFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), join(OUT, 'THIRD_PARTY_NOTICES.md'))

// ---------- 4. sharp / DOM runtime 运行时 ----------
step('Copy sharp and DOM runtime dependencies')
const copied = copyRuntimeDependencies(['sharp', 'isomorphic-dompurify'], ROOT, join(APP, 'node_modules'))
console.log(`  ${[...copied.keys()].join('、')}`)
if (!copied.has('@img/sharp-win32-x64')) throw new Error('缺少 @img/sharp-win32-x64：请在 Windows x64 上执行 pnpm install')

// ---------- 5. Node.js 运行时 ----------
step(`准备 Node.js ${NODE_VERSION} 运行时`)
const cacheZip = join(ROOT, '.cache', `node-v${NODE_VERSION}-win-x64.zip`)
let nodeZip: Buffer | null = existsSync(cacheZip) ? readFileSync(cacheZip) : null
if (nodeZip && sha256(nodeZip) !== NODE_SHA256) nodeZip = null
for (const mirror of NODE_MIRRORS) {
  if (nodeZip) break
  const url = `${mirror}/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`
  try {
    console.log(`  下载 ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (sha256(buf) !== NODE_SHA256) throw new Error('SHA-256 不一致')
    mkdirSync(dirname(cacheZip), { recursive: true })
    writeFileSync(cacheZip, buf)
    nodeZip = buf
  } catch (e) {
    console.warn(`  失败：${(e as Error).message}`)
  }
}
if (!nodeZip) throw new Error('无法获取 Node.js 运行时')
console.log(`  SHA-256 已校验 ${NODE_SHA256.slice(0, 16)}…`)
const prefix = `node-v${NODE_VERSION}-win-x64/`
const nodeFiles = unzipSync(nodeZip, { filter: (f) => f.name === `${prefix}node.exe` || f.name === `${prefix}LICENSE` })
const nodeExe = join(WORK, 'node.exe')
writeFileSync(nodeExe, nodeFiles[`${prefix}node.exe`])
mkdirSync(join(APP, 'licenses'), { recursive: true })
writeFileSync(join(APP, 'licenses', 'Node.js-LICENSE.txt'), nodeFiles[`${prefix}LICENSE`])

// ---------- 6. 启动器 EXE（Node 单文件应用） ----------
step('生成 XIUMI AI Studio.exe')
const BOOTSTRAP = `'use strict'
// XIUMI AI Studio.exe 的入口：加载同目录 app/ 下的程序
const path = require('node:path')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const dir = path.dirname(process.execPath)
const server = path.join(dir, 'app', 'server.cjs')
if (!fs.existsSync(server)) {
  console.error('找不到程序文件（app 文件夹）。\\n请把下载的压缩包完整解压，然后在解压出的文件夹里双击「XIUMI AI Studio.exe」。\\n不要只把 exe 单独复制出来；需要桌面图标时，右键 exe →「发送到」→「桌面快捷方式」。')
  if (process.stdin.isTTY) {
    console.error('\\n按任意键关闭此窗口…')
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.once('data', () => process.exit(1))
  } else process.exit(1)
} else {
  process.env.XIUMI_PACKAGED = '1'
  process.env.XIUMI_RESOURCES = path.join(dir, 'app')
  createRequire(server)(server)
}
`
writeFileSync(join(WORK, 'bootstrap.cjs'), BOOTSTRAP)
writeFileSync(join(WORK, 'sea-config.json'), JSON.stringify({ main: 'bootstrap.cjs', output: 'sea-prep.blob', disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false }))
execFileSync(nodeExe, ['--experimental-sea-config', 'sea-config.json'], { cwd: WORK, stdio: 'inherit' })

// 图标：SVG → 16/24/32/48/64/256 PNG → ICO
const svg = readFileSync(join(ROOT, 'packaging', 'icon.svg'))
const sizes = [16, 24, 32, 48, 64, 256]
const pngs = await Promise.all(sizes.map((s) => sharp(svg, { density: 384 }).resize(s, s).png().toBuffer()))
const head = Buffer.alloc(6 + 16 * sizes.length)
head.writeUInt16LE(0, 0)
head.writeUInt16LE(1, 2)
head.writeUInt16LE(sizes.length, 4)
let offset = head.length
sizes.forEach((s, i) => {
  const e = 6 + 16 * i
  head.writeUInt8(s >= 256 ? 0 : s, e)
  head.writeUInt8(s >= 256 ? 0 : s, e + 1)
  head.writeUInt16LE(1, e + 4)
  head.writeUInt16LE(32, e + 6)
  head.writeUInt32LE(pngs[i].length, e + 8)
  head.writeUInt32LE(offset, e + 12)
  offset += pngs[i].length
})
const ico = join(WORK, 'icon.ico')
writeFileSync(ico, Buffer.concat([head, ...pngs]))

copyFileSync(nodeExe, EXE)
const winVersion = `${VERSION.replace(/[^\d.]/g, '')}.0`.split('.').slice(0, 4).join('.')
await rcedit(EXE, {
  icon: ico,
  'file-version': winVersion,
  'product-version': winVersion,
  'version-string': {
    ProductName: 'XIUMI AI Studio',
    FileDescription: 'XIUMI AI Studio',
    CompanyName: 'XIUMI AI Studio',
    InternalFilename: 'XIUMI AI Studio',
    OriginalFilename: 'XIUMI AI Studio.exe',
    LegalCopyright: `Node.js ${NODE_VERSION} runtime © OpenJS Foundation and contributors (MIT)`,
  },
})
const { inject } = require('postject') as { inject: (file: string, name: string, data: Buffer, opts: { sentinelFuse: string }) => Promise<void> }
await inject(EXE, 'NODE_SEA_BLOB', readFileSync(join(WORK, 'sea-prep.blob')), { sentinelFuse: SEA_FUSE })

// ---------- 7. 许可 ----------
step('收集第三方许可')
type LicenseEntry = { name: string; versions: string[]; paths: string[]; license: string; homepage?: string }
const licenses = JSON.parse(execSync('pnpm licenses list --prod --json', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as Record<string, LicenseEntry[]>
const entries = Object.values(licenses).flat().sort((a, b) => a.name.localeCompare(b.name))
const parts = [`XIUMI AI Studio ${VERSION} 随附的第三方软件许可（${entries.length} 个生产依赖；Node.js 运行时见 Node.js-LICENSE.txt）\n`]
for (const e of entries) {
  const dir = e.paths[0]
  const file = existsSync(dir) ? readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\.|-|$)/i.test(f)) : undefined
  parts.push(`\n${'='.repeat(72)}\n${e.name} ${e.versions.join(', ')} — ${e.license}${e.homepage ? `\n${e.homepage}` : ''}\n${'='.repeat(72)}\n`)
  parts.push(file ? readFileSync(join(dir, file), 'utf8') : `（包内没有许可文件，许可类型：${e.license}）\n`)
}
writeFileSync(join(APP, 'licenses', 'THIRD_PARTY_LICENSES.txt'), parts.join(''))
console.log(`  ${entries.length} 个包`)

let commit = 'unknown'
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim() + (execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' }).trim() ? '+未提交改动' : '')
} catch {
  /* 不在 Git 仓库中 */
}
writeFileSync(join(APP, 'version.json'), JSON.stringify({ version: VERSION, node: NODE_VERSION, sharp: JSON.parse(readFileSync(join(APP, 'node_modules', 'sharp', 'package.json'), 'utf8')).version, commit, builtAt: new Date().toISOString() }, null, 2))

// ---------- 8. zip ----------
step('压缩为 zip')
function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]))
}
const zipPath = `${OUT}.zip`
await new Promise<void>((resolve, reject) => {
  const ws = createWriteStream(zipPath)
  const zip = new Zip((err, chunk, final) => {
    if (err) return reject(err)
    ws.write(chunk)
    if (final) ws.end(resolve)
  })
  for (const file of listFiles(OUT)) {
    const name = `${NAME}/${relative(OUT, file).split(sep).join('/')}`
    const f = new ZipDeflate(name, { level: 6 })
    zip.add(f)
    f.push(readFileSync(file), true)
  }
  zip.end()
})

const exeBuf = readFileSync(EXE)
const zipBuf = readFileSync(zipPath)
const folderSize = listFiles(OUT).reduce((n, f) => n + statSync(f).size, 0)
const sums = `${sha256(exeBuf)}  ${NAME}/XIUMI AI Studio.exe\n${sha256(zipBuf)}  ${NAME}.zip\n`
writeFileSync(join(RELEASE, 'SHA256SUMS.txt'), sums)
rmSync(WORK, { recursive: true, force: true })

console.log(`\n完成：
  文件夹 ${OUT}（${mb(folderSize)}）
  zip    ${zipPath}（${mb(zipBuf.length)}）
  exe    ${mb(exeBuf.length)}
${sums}`)
