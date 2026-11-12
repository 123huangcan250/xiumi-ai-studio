import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = `http://127.0.0.1:${process.env.API_PORT ?? 5174}`

export default defineConfig({
  plugins: [react()],
  // E2E 用单独的预构建缓存，不与日常开发服务器互相覆盖
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  // 启动时就扫描所有组件（含懒加载的编辑器、弹窗）的依赖，避免使用中途重新预构建导致页面刷新
  optimizeDeps: { entries: ['index.html', 'src/**/*.tsx'] },
  server: {
    port: 5173,
    proxy: { '/api': API, '/media': API },
    // 测试报告与数据目录变化不应刷新编辑器页面
    watch: { ignored: ['**/playwright-report/**', '**/test-results/**', '**/data/**', '**/data-e2e/**', '**/tests/**'] },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    // 单元测试不读取仓库 .env，避免本机配置（含密钥）影响结果
    env: { XIUMI_SKIP_ENV_FILES: '1' },
  },
})
