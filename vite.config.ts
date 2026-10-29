import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API = `http://127.0.0.1:${process.env.API_PORT ?? 5174}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': API, '/media': API },
    // 测试报告与数据目录变化不应刷新编辑器页面
    watch: { ignored: ['**/playwright-report/**', '**/test-results/**', '**/data/**', '**/data-e2e/**', '**/tests/**'] },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
})
