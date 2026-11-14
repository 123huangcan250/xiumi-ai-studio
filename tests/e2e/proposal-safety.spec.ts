import { expect, test, type Page, type Route } from '@playwright/test'

async function setup(page: Page) {
  await page.route('**/api/ai/status', route => route.fulfill({ json: { enabled: true, name: 'Synthetic proposal provider', model: 'synthetic' } }))
  await page.route('**/api/ai/suggest-instruction', route => route.fulfill({ json: { suggestion: '' } }))
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  await page.getByTestId('tab-projects').click()
  await page.getByRole('button', { name: '新建空白项目' }).click()
  await page.getByTestId('tab-blocks').click()
  await page.getByTestId('lib-card').click()
  const card = page.getByTestId('canvas').locator('[data-block-type="card"]')
  await expect(card).toHaveCount(1)
  await page.getByTestId('tab-style').click()
  await page.locator('.panel.right').getByRole('textbox', { name: '标题', exact: true }).fill('Original card title')
  return card
}
async function answer(route: Route) {
  const body = route.request().postDataJSON()
  expect(body.selectedId).toBeTruthy()
  await route.fulfill({ json: { summary: 'Synthetic title suggestion', selectionPolicy: 'filter', ignoredOps: 0, ops: [{ op: 'update', id: body.selectedId, props: { title: 'Suggested card title' } }] } })
}
async function generate(page: Page) {
  await page.getByTestId('tab-ai').click()
  await page.getByPlaceholder(/例如：把第二章/).fill('Revise only the selected card title')
  await page.getByRole('button', { name: '生成修改建议', exact: true }).click()
}

test('proposal acceptance does not overwrite a manual edit to its target', async ({ page }) => {
  const card = await setup(page)
  await page.route('**/api/ai/edit', answer)
  await generate(page)
  await expect(page.getByTestId('accept-all')).toBeVisible()
  await page.getByTestId('tab-style').click()
  await page.locator('.panel.right').getByRole('textbox', { name: '标题', exact: true }).fill('Manual card title')
  await page.getByTestId('tab-ai').click()
  await page.getByTestId('accept-all').click()
  await expect(card).toContainText('Manual card title')
  await expect(card).not.toContainText('Suggested card title')
  await expect(page.getByTestId('proposal')).toContainText('变化')
  await expect(page.getByTestId('proposal').locator('.op.rejected')).toHaveCount(1)
})

test('proposal accepts its title while retaining independently edited card content', async ({ page }) => {
  const card = await setup(page)
  await page.route('**/api/ai/edit', answer)
  await generate(page)
  await expect(page.getByTestId('accept-all')).toBeVisible()
  await page.getByTestId('tab-style').click()
  await page.locator('.panel.right').getByRole('textbox', { name: /内容/ }).fill('Independent manual body')
  await page.getByTestId('tab-ai').click()
  await page.getByTestId('accept-all').click()
  await expect(card).toContainText('Suggested card title')
  await expect(card).toContainText('Independent manual body')
  await expect(page.getByTestId('proposal').locator('.op.accepted')).toHaveCount(1)
})

test('undo and redo preserve content history without reviving accepted review actions', async ({ page }) => {
  const card = await setup(page)
  await page.route('**/api/ai/edit', answer)
  await generate(page)
  await page.getByTestId('accept-all').click()
  await expect(card).toContainText('Suggested card title')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(card).toContainText('Original card title')
  await expect(page.getByTestId('proposal')).toHaveCount(0)
  await page.getByRole('button', { name: '重做' }).click()
  await expect(card).toContainText('Suggested card title')
  await expect(page.getByTestId('proposal')).toHaveCount(0)
  await expect(page.getByTestId('accept-all')).toHaveCount(0)
})

test('late response cannot reopen review after undo and redo return to the request document', async ({ page }) => {
  const card = await setup(page)
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  let arrived = false
  await page.route('**/api/ai/edit', async route => { arrived = true; await waiting; await answer(route) })
  await generate(page)
  await expect.poll(() => arrived).toBe(true)
  const title = page.getByRole('textbox', { name: '文章标题', exact: true })
  const original = await title.inputValue()
  await title.fill('Temporary manual document title')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(title).toHaveValue(original)
  await page.getByRole('button', { name: '重做' }).click()
  await expect(title).toHaveValue('Temporary manual document title')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(title).toHaveValue(original)
  const response = page.waitForResponse('**/api/ai/edit')
  release()
  await (await response).finished()
  await expect(page.getByRole('button', { name: '生成修改建议', exact: true })).toBeEnabled()
  await expect(page.getByTestId('proposal')).toHaveCount(0)
  await expect(card).toContainText('Original card title')
})
