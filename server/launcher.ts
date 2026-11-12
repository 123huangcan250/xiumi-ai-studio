// 打包版入口（XIUMI AI Studio.exe 加载 app/server.cjs 后运行这里）。
// 负责：日志、单实例、端口选择、打开浏览器、退出与残留清理。所有提示都是中文，窗口就是“运行中”的标志。
import { spawn } from 'node:child_process'
import { accessSync, constants, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { APP_ID, DATA, LOG_DIR, TMP_DIR } from './paths'
import { addSecret, teeConsoleToFile } from './log'

export const DEFAULT_PORT = 5174
/** 首选端口被其他程序占用时依次尝试的端口数 */
export const PORT_TRIES = 20
const RUNTIME = join(DATA, 'runtime.json')

export interface RunningInfo {
  app?: string
  dataDir?: string
  pid?: number
  version?: string
}

/** 询问某个端口上是不是 XIUMI AI Studio，是的话返回它的信息 */
export async function probe(port: number, timeoutMs = 1500): Promise<RunningInfo | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/app/info`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const info = (await r.json()) as RunningInfo
    return info?.app === APP_ID ? info : null
  } catch {
    return null
  }
}

const sameDir = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** 已经在运行、且使用同一个数据目录的实例（重复双击时直接打开它） */
export async function findRunning(dataDir: string, ports: number[], ask = probe): Promise<number | null> {
  try {
    const rt = JSON.parse(readFileSync(join(dataDir, 'runtime.json'), 'utf8')) as { port?: number }
    if (rt.port && !ports.includes(rt.port)) ports = [rt.port, ...ports]
  } catch {
    /* 没有运行记录 */
  }
  for (const p of ports) {
    const info = await ask(p, 600)
    if (info && sameDir(info.dataDir, dataDir)) return p
  }
  return null
}

/** 依次尝试端口；被占用就换下一个，绝不结束占用端口的其他程序 */
export async function listenOnFreePort(server: Server, ports: number[]): Promise<number> {
  for (const port of ports) {
    const ok = await new Promise<boolean>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off('listening', onListening)
        if (e.code === 'EADDRINUSE' || e.code === 'EACCES') resolve(false)
        else reject(e)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve(true)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })
    if (ok) return port
  }
  throw Object.assign(new Error(`端口 ${ports[0]}–${ports.at(-1)} 都被其他程序占用`), { code: 'NO_PORT' })
}

export function openBrowser(url: string) {
  if (process.env.XIUMI_NO_BROWSER === '1') return
  // rundll32 交给系统默认浏览器打开，不经过命令行解析，URL 不会被拆开
  spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

function preferredPorts(): number[] {
  const base = Number(process.env.XIUMI_PORT) || DEFAULT_PORT
  return Array.from({ length: PORT_TRIES }, (_, i) => base + i)
}

const line = '─'.repeat(52)

/** 出错时保持窗口打开，让用户看清提示 */
function waitAndExit(code: number): Promise<never> {
  if (process.stdin.isTTY && process.env.XIUMI_NO_PAUSE !== '1') {
    console.log('\n按任意键关闭此窗口…')
    process.stdin.setRawMode?.(true)
    process.stdin.resume()
    process.stdin.once('data', () => process.exit(code))
    setTimeout(() => process.exit(code), 10 * 60_000).unref()
    return new Promise<never>(() => {})
  }
  process.exit(code)
}

export async function main() {
  process.title = 'XIUMI AI Studio'
  try {
    mkdirSync(DATA, { recursive: true })
    accessSync(DATA, constants.W_OK)
  } catch (e) {
    console.error(`无法写入数据目录：${DATA}\n${(e as Error).message}\n请检查磁盘空间和文件夹权限，或设置环境变量 XIUMI_DATA_DIR 指定其他位置。`)
    return waitAndExit(1)
  }
  const logFile = teeConsoleToFile(LOG_DIR)
  addSecret(process.env.AI_API_KEY)
  addSecret(process.env.WECHAT_APPSECRET)
  try {
    const { allProfiles } = await import('./settings')
    for (const p of await allProfiles()) addSecret(p.apiKey)
  } catch {
    /* 设置损坏时照常启动，界面上可以重新填写 */
  }

  console.log(line)
  console.log(' XIUMI AI Studio 正在启动…')
  const ports = preferredPorts()
  const running = await findRunning(DATA, ports)
  if (running) {
    const url = `http://127.0.0.1:${running}/`
    console.log(` 已经有一个 XIUMI AI Studio 在运行，已为你打开：${url}`)
    console.log(' 本窗口 5 秒后自动关闭。')
    openBrowser(url)
    setTimeout(() => process.exit(0), 5000)
    return
  }

  rmSync(TMP_DIR, { recursive: true, force: true })
  const { createApp, statusLine } = await import('./app')
  let port = 0
  let shuttingDown = false
  const sockets = new Set<import('node:net').Socket>()
  const shutdown = (reason: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`正在退出（${reason}）…`)
    try {
      const rt = JSON.parse(readFileSync(RUNTIME, 'utf8'))
      if (rt.pid === process.pid) rmSync(RUNTIME, { force: true })
    } catch {
      /* 没有运行记录 */
    }
    server.close(() => process.exit(0))
    for (const s of sockets) s.destroy()
    setTimeout(() => process.exit(0), 3000).unref()
  }
  const app = createApp({ port: () => port, onQuit: () => shutdown('在页面上点击了退出') })
  const { createServer } = await import('node:http')
  const server = createServer(app)
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  try {
    port = await listenOnFreePort(server, ports)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    console.error(err.code === 'NO_PORT' ? `启动失败：${err.message}。请关闭占用这些端口的程序后重试，或设置环境变量 XIUMI_PORT 指定其他端口。` : `启动失败：${err.stack ?? err.message}`)
    console.error(`日志：${logFile}`)
    return waitAndExit(1)
  }
  server.on('error', (e) => console.error('服务错误', e))
  writeFileSync(RUNTIME, JSON.stringify({ app: APP_ID, pid: process.pid, port, startedAt: new Date().toISOString() }))
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(sig, () => shutdown(sig === 'SIGHUP' ? '窗口已关闭' : sig))

  const url = `http://127.0.0.1:${port}/`
  console.log(await statusLine(port))
  if (port !== ports[0]) console.log(` 端口 ${ports[0]} 被其他程序占用，已改用 ${port}。`)
  console.log(line)
  console.log(` 已启动：${url}`)
  console.log(' 浏览器会自动打开；没有打开时，把上面的地址复制到浏览器。')
  console.log(' 退出：关闭此窗口，或在页面右上角点「退出」。')
  console.log(` 数据保存在：${DATA}`)
  console.log(` 日志：${logFile}`)
  console.log(line)
  openBrowser(url)
}

process.on('uncaughtException', (e) => console.error('未处理的错误', e))
process.on('unhandledRejection', (e) => console.error('未处理的异步错误', e))

if (process.env.XIUMI_PACKAGED === '1') {
  main().catch((e) => {
    console.error(`启动失败：${(e as Error).stack ?? e}`)
    waitAndExit(1)
  })
}
