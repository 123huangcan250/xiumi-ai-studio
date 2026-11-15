import { expect, test } from '@playwright/test'

test('a successful project-list body failure never creates a draft and refresh preserves disk projects', async ({ page }) => {
  const id = `startup-body-${Date.now()}`
  const now = Date.now()
  expect((await page.request.put(`/api/projects/${id}`, { data: { id, title: 'Preserve this disk title', author: '', digest: '', themeId: 'tsinghua-purple', createdAt: now, updatedAt: now, blocks: [] } })).ok()).toBeTruthy()
  const summaries = async () => (await (await page.request.get('/api/projects')).json() as { id: string; title: string }[]).map(({id,title})=>({id,title})).sort((a,b)=>a.id.localeCompare(b.id))
  const before = await summaries()
  await page.addInitScript(() => {
    if (sessionStorage.getItem('body-proof-complete')) return
    const actual = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await actual(...args)
      if (new URL(String(args[0]), location.href).pathname === '/api/projects' && response.ok) {
        response.json = async () => { throw new DOMException('controlled successful-body abort', 'AbortError') }
      }
      return response
    }
  })
  const puts: string[] = []
  page.on('request', request => { if (request.method() === 'PUT') puts.push(request.url()) })
  await page.goto('/')
  await expect(page.locator('.toast')).toContainText('controlled successful-body abort', { timeout: 10000 })
  expect(puts).toEqual([])
  expect(await summaries()).toEqual(before)
  await page.evaluate(() => sessionStorage.setItem('body-proof-complete', '1'))
  await page.reload()
  await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue('Preserve this disk title')
  expect(await summaries()).toEqual(before)
})
