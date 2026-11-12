// 日志：写入 <数据目录>/logs/xiumi-YYYY-MM-DD.log，保留最近 14 天。
// 写入前去掉密钥：已知的配置值整串替换，常见密钥格式按规则打码。
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { format } from 'node:util'

const secrets = new Set<string>()
/** 登记需要从日志中去掉的值（AI 密钥、公众号 AppSecret 等） */
export function addSecret(value: string | undefined) {
  if (value && value.length >= 6) secrets.add(value)
}

export function redact(text: string): string {
  let out = text
  for (const s of secrets) out = out.split(s).join('***')
  return out
    .replace(/\b(sk|ak|pk)-[A-Za-z0-9_-]{8,}/g, '$1-***')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1***')
    .replace(/((?:api[_-]?key|secret|appsecret|access_token|x-api-key)["']?\s*[:=]\s*["']?)[^\s"'&,}]+/gi, '$1***')
}

const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 把 console 输出同时写入日志文件；返回当天日志文件路径 */
export function teeConsoleToFile(dir: string, keepDays = 14): string {
  mkdirSync(dir, { recursive: true })
  try {
    const old = readdirSync(dir).filter((f) => /^xiumi-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort().slice(0, -keepDays)
    for (const f of old) rmSync(join(dir, f), { force: true })
  } catch {
    /* 清理失败不影响启动 */
  }
  const file = () => join(dir, `xiumi-${day()}.log`)
  const write = (level: string, args: unknown[]) => {
    try {
      appendFileSync(file(), `${new Date().toISOString()} [${level}] ${redact(format(...args))}\n`)
    } catch {
      /* 磁盘满等情况下不影响运行 */
    }
  }
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    const orig = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      write(level, args)
      orig(...args.map((a) => (typeof a === 'string' ? redact(a) : a instanceof Error ? redact(a.stack ?? a.message) : a)))
    }
  }
  return file()
}
