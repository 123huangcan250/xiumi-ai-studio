import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
async function config(target: string) {
  vi.stubEnv('E2E_TARGET', target)
  vi.resetModules()
  return (await import('../../playwright.config')).default
}
it('uses one explicit IPv4 loopback address for development serving, readiness and browser navigation', async () => {
  const settings = await config('')
  expect(settings.use?.baseURL).toBe('http://127.0.0.1:5273')
  const servers = settings.webServer as any[]
  expect(servers).toHaveLength(2)
  expect(servers[0].url).toBe('http://127.0.0.1:5274/api/app/info')
  expect(servers[1].url).toBe('http://127.0.0.1:5273')
  expect(servers[1].command).toContain('--host 127.0.0.1')
  expect(servers.every(server => !('port' in server) && server.reuseExistingServer === false)).toBe(true)
  expect(servers[0].env).toEqual({ API_PORT: '5274', DATA_DIR: 'data-e2e', XIUMI_SKIP_ENV_FILES: '1' })
  expect(servers[1].env).toEqual({ API_PORT: '5274', VITE_CACHE_DIR: 'node_modules/.vite-e2e' })
  expect(settings.timeout).toBe(90_000)
  expect(settings.retries).toBeUndefined()
  expect(settings.updateSnapshots).toBe('missing')
  expect(settings.expect?.toHaveScreenshot?.maxDiffPixelRatio).toBe(0.01)
})
it('preserves the separate packaged mode and its launch environment', async () => {
  const settings = await config('packaged')
  const servers = settings.webServer as any[]
  expect(settings.use?.baseURL).toBe('http://127.0.0.1:5284')
  expect(servers).toHaveLength(1)
  expect(servers[0].url).toBe('http://127.0.0.1:5284/api/app/info')
  expect(servers[0].command).toContain('XIUMI AI Studio.exe')
  expect(servers[0].env).toEqual({ XIUMI_DATA_DIR: 'data-e2e-pkg', XIUMI_PORT: '5284', XIUMI_NO_BROWSER: '1', XIUMI_NO_PAUSE: '1' })
  expect(servers[0].reuseExistingServer).toBe(false)
})
