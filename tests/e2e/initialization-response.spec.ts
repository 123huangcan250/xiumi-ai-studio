import { test, expect } from '@playwright/test'

test('failed success-body read never persists an empty project and reload recovers the seed', async ({ page }) => {
  const id = `body-boundary-${Date.now()}`
  const title = '初始化响应中断后仍恢复原文稿'
  const now = Date.now()
  expect((await page.request.put('/api/projects/' + id, { data: { id, title, author: '', digest: '', themeId: 'minimal-magazine', createdAt: now, updatedAt: now, blocks: [] } })).ok()).toBeTruthy()
  const before = await (await page.request.get('/api/projects')).json()
  await page.addInitScript(() => {
    const original = window.fetch.bind(window)
    const state = { writes: 0, bodyFaults: 0 }
    Object.assign(window, { __initializationProof: state })
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href)
      if (url.pathname.startsWith('/api/projects/') && init?.method === 'PUT') state.writes++
      const response = await original(input, init)
      if (url.pathname === '/api/projects' && (!init?.method || init.method === 'GET') && !sessionStorage.getItem('body-fault-used')) {
        sessionStorage.setItem('body-fault-used', 'yes')
        return new Proxy(response, { get(target, key) {
          if (key === 'json') return async () => { state.bodyFaults++; throw new DOMException('controlled body cancellation after 200 headers', 'AbortError') }
          const value = Reflect.get(target, key, target)
          return typeof value === 'function' ? value.bind(target) : value
        } })
      }
      return response
    }
  })
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __initializationProof: { writes: number; bodyFaults: number } }).__initializationProof)).toEqual({ writes: 0, bodyFaults: 1 })
  await page.reload()
  await expect(page.locator('.title-input')).toHaveValue(title)
  const after = await (await page.request.get('/api/projects')).json()
  expect(after.map((item: { id: string }) => item.id).sort()).toEqual(before.map((item: { id: string }) => item.id).sort())
})
