import { defineConfig } from '@playwright/test'
import shell from './playwright.shell.config'
import upstream from './playwright.config'

/** Existing upstream scenarios retain light mode while sharing isolated shell servers. */
export default defineConfig({
  ...shell,
  expect: upstream.expect,
  testDir: 'tests/e2e',
  timeout: 90_000,
  use: {
    ...shell.use,
    permissions: ['clipboard-read', 'clipboard-write'],
    storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:5873', localStorage: [{ name: 'xiumi-color-mode', value: 'light' }] }] },
  },
})
