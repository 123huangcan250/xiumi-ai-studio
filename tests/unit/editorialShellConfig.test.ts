import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

it.each([
  ['dev', 'http://127.0.0.1:5273'],
  ['packaged', 'http://127.0.0.1:5284'],
])('pins only %s test browser storage to the matching origin', async (target, origin) => {
  vi.stubEnv('E2E_TARGET', target)
  vi.resetModules()
  const { default: config } = await import('../../playwright.config')
  expect(config.use?.baseURL).toBe(origin)
  expect(config.use?.storageState).toEqual({ cookies: [], origins: [{ origin, localStorage: [{ name: 'xiumi-color-mode', value: 'light' }] }] })
  expect(config.expect?.toHaveScreenshot?.maxDiffPixelRatio).toBe(.01)
})

it('runs shell coverage after upstream E2E and retains separate failure artifacts', async () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
  expect(workflow.indexOf('playwright.shell.config.ts')).toBeGreaterThan(workflow.indexOf('pnpm e2e --update-snapshots=none'))
  expect(workflow).toContain('test-results-shell/')
  expect(workflow).toContain("SHELL_PHASE: 'after'")
  const { default: shell } = await import('../../playwright.shell.config')
  expect(shell.outputDir).toBe('test-results-shell')
  expect(shell.updateSnapshots).toBe('none')
  expect(shell.use?.trace).toBe('retain-on-failure')
})
