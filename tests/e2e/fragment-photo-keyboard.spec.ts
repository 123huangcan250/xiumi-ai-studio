import { expect, test } from '@playwright/test'

test('fragment photo and background choices support keyboard replacement without losing text', async ({ page }) => {
  const { assets } = await (await page.request.post('/api/samples/load')).json()
  expect(assets.length).toBeGreaterThanOrEqual(3)
  const [first, second, third] = assets
  const now = Date.now()
  const id = 'keyboard-photo-' + now
  const title = '素材替换验收'
  const html = `<section><p>保留原文</p><img src="/media/${first.file}" style="width:100%"><svg viewBox="0 0 1080 720" style="display:block;background-image:url('/media/${first.file}');background-size:100%"></svg></section>`
  const doc = { id, title, author: '', digest: '', themeId: 'tsinghua-purple', createdAt: now, updatedAt: now, blocks: [{ id: 'fragment', type: 'html', props: { html, label: '原文片段' } }] }
  expect((await page.request.put('/api/projects/' + id, { data: doc })).ok()).toBe(true)
  await page.route('**/api/projects', r => r.fulfill({ json: [{ id, title }] }))
  await page.goto('/')
  await expect(page.locator('.title-input')).toHaveValue(title)
  const fragment = page.locator('[data-block-id="fragment"]')
  await fragment.click({ position: { x: 5, y: 5 } })
  const photo = page.getByRole('button', { name: '替换第 1 张图片', exact: true })
  await expect(photo).toBeVisible()
  await photo.focus()
  await photo.press('Space')
  await expect(photo).toHaveAttribute('aria-pressed', 'true')
  const asset = page.getByRole('button', { name: '使用素材：' + second.name, exact: true }).filter({ has: page.locator(`img[src^="/media/${second.file}?"]`) })
  await asset.focus()
  await asset.press('Enter')
  await expect(fragment.locator('.block-html img')).toHaveAttribute('src', new RegExp(second.file))
  const bg = page.getByRole('button', { name: '替换第 1 张背景图', exact: true })
  await bg.focus()
  await bg.press('Enter')
  await expect(bg).toHaveAttribute('aria-pressed', 'true')
  const bgAsset = page.getByRole('button', { name: '使用背景素材：' + third.name, exact: true }).filter({ has: page.locator(`img[src^="/media/${third.file}?"]`) })
  await bgAsset.focus()
  await bgAsset.press('Space')
  await expect.poll(() => fragment.locator('svg').getAttribute('style')).toContain(third.file)
  await expect(fragment).toContainText('保留原文')
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await page.reload()
  await expect(fragment.locator('.block-html img')).toHaveAttribute('src', new RegExp(second.file))
  await expect.poll(() => fragment.locator('svg').getAttribute('style')).toContain(third.file)
  await expect(fragment).toContainText('保留原文')
})
