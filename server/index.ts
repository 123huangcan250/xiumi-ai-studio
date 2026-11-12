// 源码运行入口（pnpm dev / pnpm start / E2E）：只监听回环地址，端口来自 API_PORT。
// 打包版的入口是 launcher.ts。
import { createApp, statusLine } from './app'

const port = Number(process.env.API_PORT ?? 5174)
const server = createApp({ port: () => port }).listen(port, '127.0.0.1', async () => {
  console.log(await statusLine(port))
})
server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `端口 ${port} 已被占用：可能已有一个 XIUMI AI Studio 在运行，或用 API_PORT 指定其他端口` : e)
  process.exit(1)
})
