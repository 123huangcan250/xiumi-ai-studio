// 文字颜色：正文富文本选中文字改色，原文片段按行改色，默认颜色可恢复
import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({page}) => { await page.addInitScript(() => localStorage.setItem('xiumi-color-mode','dark')) })

const rich = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

async function seed(page: Page, name: string, blocks: unknown[]) {
  const now = Date.now()
  const id = `color-${now}-${Math.floor(Math.random() * 1e6)}`
  const res = await page.request.put(`/api/projects/${id}`, { data: { id, title: name, author: '', digest: '', themeId: 'minimal-magazine', createdAt: now, updatedAt: now, blocks } })
  expect(res.ok(), await res.text()).toBe(true)
  await page.goto('/')
  await page.reload()
  await expect(page.locator('.title-input')).toHaveValue(name)
}

test('正文：选中文字后选颜色，可自定义，也可恢复默认', async ({ page }) => {
  await seed(page, '正文改色', [{ id: 'p1', type: 'paragraph', props: { content: rich('需要改色的文字'), align: 'justify' } }])
  const block = page.locator('[data-block-id="p1"]')
  await block.dblclick()
  const content = page.locator('.rich-content .ProseMirror')
  await expect(content).toBeVisible()
  await content.click()
  await page.keyboard.press('Control+A')

  await page.getByTestId('rich-color').click()
  await page.getByTestId('rich-color-pop').getByRole('button', { name: '红色' }).click()
  await expect(page.getByTestId('rich-color-pop')).toBeHidden()
  await expect(content.locator('span[style*="color"]')).toHaveCSS('color', 'rgb(192, 57, 43)')
  // Esc 只关闭取色板，不退出编辑
  await page.getByTestId('rich-color').click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('rich-color-pop')).toBeHidden()
  await expect(content).toBeVisible()
  // 选区仍在，可以继续改色：自定义颜色
  await page.getByTestId('rich-color').click()
  await page.getByTestId('rich-color-custom').fill('#1f3a93')
  await expect(content.locator('span[style*="color"]')).toHaveCSS('color', 'rgb(31, 58, 147)')

  await page.getByRole('button', { name: '完成' }).click()
  await expect(block.locator('span[style*="color"]').first()).toHaveCSS('color', 'rgb(31, 58, 147)')
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })

  // 恢复默认颜色
  await block.dblclick()
  await content.click()
  await page.keyboard.press('Control+A')
  await page.getByTestId('rich-color').click()
  await page.getByTestId('rich-color-reset').click()
  await expect(content.locator('span[style*="color"]')).toHaveCount(0)
})

test('原文片段：每行文字可单独改色，不影响其他行', async ({ page }) => {
  const html = '<p style="font-size: 20px; color: rgb(51, 51, 51)"><strong><span style="color: #8a1c2b">【</span>开幕式<span style="color: #8a1c2b">】</span></strong></p><p style="font-size: 15px; color: rgb(80, 80, 80)">正文一段文字。</p>'
  await seed(page, '片段改色', [{ id: 'h1', type: 'html', props: { html, label: '片段' } }])
  const block = page.locator('[data-block-id="h1"]')
  await block.click({ position: { x: 3, y: 3 } })

  await page.getByTestId('color-t0').click()
  const pop = page.getByTestId('color-t0-pop')
  await expect(pop).toContainText('片段配色')
  await pop.getByRole('button', { name: '绿色' }).click()
  const title = block.locator('p').first()
  await expect(title).toHaveCSS('color', 'rgb(39, 174, 96)')
  // 标题里原来的括号颜色被统一成新颜色
  await expect(title.locator('span').first()).toHaveCSS('color', 'rgb(39, 174, 96)')
  await expect(block.locator('p').nth(1)).toHaveCSS('color', 'rgb(80, 80, 80)')

  await page.keyboard.press('Control+Z')
  await expect(title.locator('span').first()).toHaveCSS('color', 'rgb(138, 28, 43)')
})
