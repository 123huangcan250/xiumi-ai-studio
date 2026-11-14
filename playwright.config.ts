import { readFileSync } from 'node:fs'
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'

// E2E 使用独立端口与数据目录，不影响日常使用的 data/
// E2E_TARGET=packaged（pnpm e2e:package）时改为测试打包好的 XIUMI AI Studio.exe
const packaged = process.env.E2E_TARGET === 'packaged'
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const exe = `release/XIUMI-AI-Studio-${version}-win-x64/XIUMI AI Studio.exe`

const devServers: PlaywrightTestConfig['webServer'] = [
  {
    // 每次运行前清空 E2E 数据目录
    command: `node -e "require('fs').rmSync('data-e2e',{recursive:true,force:true})" && npx tsx server/index.ts`,
    // 不读开发者自己的 .env：里面的公众号凭据会让“未配置接口”的用例走到另一条分支
    env: { API_PORT: '5274', DATA_DIR: 'data-e2e', XIUMI_SKIP_ENV_FILES: '1' },
    url: 'http://127.0.0.1:5274/api/app/info',
    reuseExistingServer: false,
  },
  {
    command: 'npx vite --host 127.0.0.1 --port 5273 --strictPort',
    env: { API_PORT: '5274', VITE_CACHE_DIR: 'node_modules/.vite-e2e' },
    url: 'http://127.0.0.1:5273',
    reuseExistingServer: false,
  },
]
const packagedServer: PlaywrightTestConfig['webServer'] = [
  {
    command: `node -e "require('fs').rmSync('data-e2e-pkg',{recursive:true,force:true})" && "${exe}"`,
    env: { XIUMI_DATA_DIR: 'data-e2e-pkg', XIUMI_PORT: '5284', XIUMI_NO_BROWSER: '1', XIUMI_NO_PAUSE: '1' },
    url: 'http://127.0.0.1:5284/api/app/info',
    reuseExistingServer: false,
  },
]

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  fullyParallel: false,
  workers: 1,
  // 首次运行生成截图基线；之后与基线比较（视觉回归）
  updateSnapshots: 'missing',
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: packaged ? 'http://127.0.0.1:5284' : 'http://127.0.0.1:5273',
    // Test-only determinism: product automatic day/night mode remains unchanged.
    storageState: { cookies: [], origins: [{ origin: packaged ? 'http://127.0.0.1:5284' : 'http://127.0.0.1:5273', localStorage: [{ name: 'xiumi-color-mode', value: 'light' }] }] },
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: packaged ? packagedServer : devServers,
})
