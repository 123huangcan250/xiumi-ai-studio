import { defineConfig, devices } from '@playwright/test'

// E2E 使用独立端口与数据目录，不影响日常使用的 data/
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
    baseURL: 'http://localhost:5273',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: [
    {
      // 每次运行前清空 E2E 数据目录
      command: `node -e "require('fs').rmSync('data-e2e',{recursive:true,force:true})" && npx tsx server/index.ts`,
      env: { API_PORT: '5274', DATA_DIR: 'data-e2e' },
      port: 5274,
      reuseExistingServer: false,
    },
    {
      command: 'npx vite --port 5273 --strictPort',
      env: { API_PORT: '5274' },
      port: 5273,
      reuseExistingServer: false,
    },
  ],
})
