// 递归复制目录。不用 fs.cpSync：Node 22.18 在 Windows 上会把含中文的目标路径写成乱码目录。
// 符号链接（pnpm 的 node_modules）按实际内容复制。
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export function copyDir(src: string, dst: string, skip = new Set<string>()) {
  mkdirSync(dst, { recursive: true })
  for (const name of readdirSync(src)) {
    if (skip.has(name)) continue
    const from = join(src, name)
    const to = join(dst, name)
    if (statSync(from).isDirectory()) copyDir(from, to, skip)
    else copyFileSync(from, to)
  }
}
