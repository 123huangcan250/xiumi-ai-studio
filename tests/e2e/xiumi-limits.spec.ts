import { expect, test } from '@playwright/test'

async function openExport(page: import('@playwright/test').Page, html: string) {
  await page.route('**/api/wechat/status', route => route.fulfill({ json: { configured: true } }))
  await page.goto('/')
  const now = Date.now()
  const id = `xiumi-limit-${now}`
  await page.request.put(`/api/projects/${id}`, { data: { id, title: '秀米上限测试', author: '', digest: '', themeId: 'tsinghua-purple', createdAt: now, updatedAt: now, blocks: [
    { id: 'long', type: 'html', props: { label: '长文', html } },
    { id: 'image', type: 'image', props: { image: { src: '/media/preflight-only.jpg' }, caption: '', variant: 'full' } },
  ] } })
  await page.reload()
  await page.getByTestId('open-export').click()
}

test('cancelling multipart upload confirmation sends no images and downloads nothing', async ({ page }) => {
  let uploads = 0
  let downloads = 0
  await page.route('**/api/wechat/upload-images', route => { uploads++; return route.fulfill({ json: {} }) })
  page.on('download', () => downloads++)
  await openExport(page, `<section>${Array.from({ length: 8 }, (_, i) => `<p>${i}${'字'.repeat(20000)}</p>`).join('')}</section>`)
  let prompted = false
  page.once('dialog', async dialog => { prompted = true; expect(dialog.message()).toContain('份文件'); await dialog.dismiss() })
  await page.getByTestId('xiumi-upload').click()
  await expect.poll(() => prompted).toBe(true)
  await expect(page.getByTestId('xiumi-upload')).toBeEnabled()
  expect(uploads).toBe(0)
  expect(downloads).toBe(0)
})

test('indivisible oversized content blocks both Xiumi paths before upload or download', async ({ page }) => {
  let uploads = 0
  let downloads = 0
  await page.route('**/api/wechat/upload-images', route => { uploads++; return route.fulfill({ json: {} }) })
  page.on('download', () => downloads++)
  await openExport(page, `<p>${'字'.repeat(140000)}</p>`)
  for (const action of ['xiumi-package', 'xiumi-upload']) {
    await page.getByTestId(action).click()
    await expect(page.locator('.toast')).toContainText('请手动拆分')
    await expect(page.getByTestId(action)).toBeEnabled()
  }
  expect(uploads).toBe(0)
  expect(downloads).toBe(0)
})
