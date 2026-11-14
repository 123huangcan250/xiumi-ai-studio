import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('lib-paragraph').click()
})

test('plain-text edits retain boundary spaces and empty paragraphs after reselecting', async ({ page }) => {
  const field = page.getByLabel('正文', { exact: false }).first()
  await field.fill('  第一段  \n\n 第二段 ')
  await page.getByLabel('文章标题', { exact: true }).click()
  await page.locator('[data-block-type="paragraph"]').last().click()
  await expect(field).toHaveValue('  第一段  \n\n 第二段 ')
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.locator('[data-block-type="paragraph"]').last().click()
  await expect(field).toHaveValue('  第一段  \n\n 第二段 ')
})

test('paragraph alignment offers all four choices and overrides inline alignment', async ({ page }) => {
  await page.locator('[data-block-type="paragraph"]').last().dblclick()
  await page.locator('.rich-toolbar').getByRole('button', { name: '居中', exact: true }).click()
  await page.locator('.rich-toolbar').getByRole('button', { name: '完成', exact: true }).click()
  await page.locator('.panel.right').getByRole('button', { name: '右对齐', exact: true }).click()
  await expect(page.locator('[data-block-type="paragraph"]').last().locator('p').first()).toHaveCSS('text-align', 'right')
  await page.locator('.panel.right').getByRole('button', { name: '左对齐', exact: true }).click()
  await expect(page.locator('[data-block-type="paragraph"]').last().locator('p').first()).toHaveCSS('text-align', 'left')
})

test('dialog isolates keyboard shortcuts and returns focus to its trigger', async ({ page }) => {
  const blocks = page.locator('[data-block-type="paragraph"]')
  const count = await blocks.count()
  await page.getByTestId('open-export').click()
  const dialog = page.getByRole('dialog', { name: '导出与发布', exact: true })
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => dialog.evaluate(el => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Delete')
  await page.keyboard.press('Control+z')
  await expect(blocks).toHaveCount(count)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(page.getByTestId('open-export')).toBeFocused()
})

test('Escape dismisses only the top nested dialog', async ({ page }) => {
  await page.route('**/api/wechat/status', route => route.fulfill({ json: { configured: true } }))
  await page.getByTestId('open-export').click()
  await page.getByRole('button', { name: '推送到草稿箱…', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '确认推送到公众号草稿箱', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '确认推送到公众号草稿箱', exact: true })).not.toBeVisible()
  await expect(page.getByRole('dialog', { name: '导出与发布', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '推送到草稿箱…', exact: true })).toBeFocused()
})
