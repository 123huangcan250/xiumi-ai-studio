import { expect, test } from '@playwright/test'

test('StrictMode initializes and normalizes the current revision only once', async ({ page }) => {
  const id = `startup-${Date.now()}`
  const now = Date.now()
  const created = await page.request.put(`/api/projects/${id}`, { data: {
    id, title: 'startup fixture', author: '', digest: '', themeId: 'tsinghua-purple', createdAt: now, updatedAt: now,
    blocks: [{ id: 'normalizable', type: 'html', props: { html: '<p>legacy content</p>' } }],
  } })
  expect(created.ok()).toBe(true)
  let lists = 0
  let reads = 0
  const writes: number[] = []
  page.on('request', request => {
    if (request.method() === 'GET' && request.url().endsWith('/api/projects')) lists++
    if (request.method() === 'GET' && request.url().endsWith(`/api/projects/${id}`)) reads++
  })
  page.on('response', response => {
    if (response.request().method() === 'PUT' && response.url().endsWith(`/api/projects/${id}`)) writes.push(response.status())
  })
  await page.goto('/')
  await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue('startup fixture')
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  expect(lists).toBe(1)
  expect(reads).toBe(1)
  expect(writes).toEqual([200])
})

test('typing while startup is pending wins over a delayed project response', async ({ page }) => {
  const now = Date.now()
  const id = `startup-held-${now}`
  await page.request.put(`/api/projects/${id}`, { data: { id, title: 'old disk draft', author: '', digest: '', themeId: 'tsinghua-purple', createdAt: now, updatedAt: now, blocks: [] } })
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let requested = false
  await page.route('**/api/projects', async route => {
    if (route.request().method() !== 'GET') return route.continue()
    requested = true
    await gate
    await route.fulfill({ json: [{ id, title: 'old disk draft', updatedAt: now, themeId: 'tsinghua-purple', blockCount: 0 }] })
  })
  await page.goto('/')
  await expect.poll(() => requested).toBe(true)
  await page.getByLabel('文章标题', { exact: true }).fill('work while starting')
  const response = page.waitForResponse(r => r.url().endsWith(`/api/projects/${id}`))
  release()
  expect(await (await response).finished()).toBeNull()
  await expect(page.locator('.toast')).toContainText('等待期间文档已变化')
  await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue('work while starting')
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
})
