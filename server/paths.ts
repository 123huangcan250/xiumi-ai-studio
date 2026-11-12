// 运行路径与配置加载。其他服务端模块在加载时就会读取数据目录和环境变量，所以本模块必须最先执行
// （store.ts 依赖本模块，任何读写数据的模块都会先触发这里）。
//
// 两种运行方式：
// - 源码运行（pnpm dev / pnpm start）：资源和数据都在仓库内，数据默认 <仓库>/data，配置读 <仓库>/.env
// - 打包运行（XIUMI AI Studio.exe）：资源在程序目录 app/ 下（只读），数据在用户目录（可写，升级、删除程序都不影响）
//
// 环境变量优先级：系统环境变量 > <仓库>/.env（仅源码运行）> <数据目录>/.env
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const APP_ID = 'xiumi-ai-studio'
export const PACKAGED = process.env.XIUMI_PACKAGED === '1'

/** 只读资源根目录：前端 dist、samples。打包时由启动器指定 */
export const ROOT = resolve(process.env.XIUMI_RESOURCES ?? join(import.meta.dirname, '..'))

const skipEnvFiles = process.env.XIUMI_SKIP_ENV_FILES === '1'
export const loadedEnvFiles: string[] = []
function loadEnv(file: string) {
  if (skipEnvFiles || !existsSync(file)) return
  try {
    process.loadEnvFile(file)
    loadedEnvFiles.push(file)
  } catch (e) {
    console.error(`读取配置文件失败：${file}（${(e as Error).message}）`)
  }
}

// 先读仓库 .env：它可以指定 DATA_DIR
if (!PACKAGED) loadEnv(join(ROOT, '.env'))

/** 打包版的默认数据目录：%LOCALAPPDATA%\XIUMI AI Studio */
export function defaultUserDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.LOCALAPPDATA || (env.APPDATA ? join(env.APPDATA, '..', 'Local') : join(homedir(), 'AppData', 'Local'))
  return join(base, 'XIUMI AI Studio')
}

export const DATA = resolve(process.env.XIUMI_DATA_DIR ?? process.env.DATA_DIR ?? (PACKAGED ? defaultUserDataDir() : join(ROOT, 'data')))
/** 数据目录里的 .env：打包版填写公众号 AppID/AppSecret 的位置 */
export const DATA_ENV = join(DATA, '.env')
loadEnv(DATA_ENV)

export const LOG_DIR = join(DATA, 'logs')
export const TMP_DIR = join(DATA, 'tmp')
