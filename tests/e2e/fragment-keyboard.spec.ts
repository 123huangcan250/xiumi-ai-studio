import { test, expect } from '@playwright/test'

test('keyboard navigation selects and collects an imported fragment in document order', async ({ page }) => {
  const now = Date.now()
  const id = 'fragment-keyboard-' + now
  const response = await page.request.put('/api/projects/' + id, { data: {
    id, title: '键盘收藏测试', author: '', digest: '', themeId: 'minimal-magazine', createdAt: now, updatedAt: now,
    blocks: [{ id: 'imported', type: 'html', props: { label: '原文', html: '<section><p>第一段</p><p>第二段</p><p>第三段</p></section>' } }],
  } })
  expect(response.ok()).toBeTruthy()
  await page.goto('/')
  await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue('键盘收藏测试')
  const block = page.locator('[data-block-id="imported"]')
  await block.click({ position: { x: 5, y: 5 } })
  await block.getByTestId('pick-fragment').click()
  const picker = page.getByTestId('fragment-picker')
  await expect(picker).toBeVisible()
  const selected = picker.locator('.fragment-picked')
  await page.keyboard.press('ArrowDown')
  await expect(selected).toHaveText('第一段', { timeout: 3000 })
  await page.keyboard.press('ArrowDown')
  await expect(selected).toHaveText('第二段')
  await page.keyboard.press('End')
  await expect(selected).toHaveText('第三段')
  await page.keyboard.press('ArrowDown')
  await expect(selected).toHaveText('第三段')
  await page.keyboard.press('Home')
  await expect(selected).toHaveText('第一段')
  await page.getByTestId('pick-next').click()
  await expect(selected).toHaveText('第二段')
  await page.getByTestId('pick-prev').click()
  await expect(selected).toHaveText('第一段')
  await page.getByTestId('pick-collect').click()
  await expect(page.getByTestId('collect-preview')).toContainText('第一段')
  await expect(page.getByTestId('collect-preview')).not.toContainText('第二段')
})
