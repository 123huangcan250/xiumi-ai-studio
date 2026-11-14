import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page) {
  await page.route('**/api/ai/status', route => route.fulfill({ json: { enabled: true, name: 'Synthetic', model: 'synthetic', provider: 'openai', profileId: 'synthetic' } }))
  await page.route('**/api/ai/suggest-instruction', route => route.fulfill({ json: { suggestion: '' } }))
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  await page.getByTestId('tab-projects').click()
  await page.getByRole('button', { name: '新建空白项目' }).click()
  await page.getByTestId('tab-blocks').click()
  for (const title of ['Selection A', 'Selection B']) {
    await page.getByTestId('lib-card').click()
    await page.getByTestId('tab-style').click()
    await page.locator('.panel.right').getByRole('textbox', { name: '标题', exact: true }).fill(title)
  }
  const cards = page.getByTestId('canvas').locator('[data-block-type="card"]')
  await expect(cards).toHaveCount(2)
  return cards
}

test('manual whole-document scope expires on A to B selection and deselection', async ({ page }) => {
  const cards = await setup(page)
  await cards.nth(0).locator('.block-html').click()
  await page.getByTestId('tab-ai').click()
  const scope = page.getByLabel('修改范围')
  await expect(scope).toHaveValue('selection')
  await scope.selectOption('document')
  await page.getByRole('textbox', { name: '文章标题', exact: true }).fill('Same selection, edited document')
  await expect(scope).toHaveValue('document')
  await cards.nth(1).locator('.block-html').click()
  await expect(scope).toHaveValue('selection')
  await expect(scope.locator('option:checked')).toContainText('Selection B')
  await page.locator('.phone-head').click()
  await expect(scope).toHaveValue('document')
  await cards.nth(0).locator('.block-html').click()
  await expect(scope).toHaveValue('selection')
  await expect(scope.locator('option:checked')).toContainText('Selection A')
})

test('properties and scope stay consistent after deleting selected content and undoing', async ({ page }) => {
  const cards = await setup(page)
  await cards.nth(1).locator('.block-html').click()
  await page.getByTestId('tab-style').click()
  const title = page.locator('.panel.right').getByRole('textbox', { name: '标题', exact: true })
  await expect(title).toHaveValue('Selection B')
  await cards.nth(1).getByTitle('删除（Delete）').click()
  await expect(cards).toHaveCount(1)
  await expect(title).toHaveValue('Selection A')
  await page.getByTestId('tab-ai').click()
  await expect(page.getByLabel('修改范围')).toHaveValue('selection')
  await expect(page.getByLabel('修改范围').locator('option:checked')).toContainText('Selection A')
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(cards).toHaveCount(2)
  await cards.nth(1).locator('.block-html').click()
  await expect(page.getByLabel('修改范围').locator('option:checked')).toContainText('Selection B')
  await page.getByRole('button', { name: '重做' }).click()
  await expect(cards).toHaveCount(1)
  await expect(page.getByLabel('修改范围')).toHaveValue('document')
  await page.getByTestId('tab-style').click()
  await expect(page.getByLabel('作者（≤16 字）')).toBeVisible()
})

test('a delayed selection A response stays obsolete after switching to B and back to A', async ({ page }) => {
  const cards = await setup(page)
  await cards.nth(0).locator('.block-html').click()
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let started = false
  await page.route('**/api/ai/edit', async route => {
    const body = route.request().postDataJSON()
    started = true
    await pending
    await route.fulfill({ json: { summary: 'Obsolete A response', selectionPolicy: 'filter', ignoredOps: 0, ops: [{ op: 'update', id: body.selectedId, props: { title: 'Wrong late title' } }] } })
  })
  await page.getByTestId('tab-ai').click()
  await page.getByPlaceholder(/例如：把第二章/).fill('Change this card title')
  await page.getByRole('button', { name: '生成修改建议', exact: true }).click()
  await expect.poll(() => started).toBe(true)
  await cards.nth(1).locator('.block-html').click()
  await cards.nth(0).locator('.block-html').click()
  await page.getByLabel('修改范围').selectOption('document')
  const response = page.waitForResponse('**/api/ai/edit')
  release()
  await (await response).finished()
  await expect(page.getByRole('button', { name: '生成修改建议', exact: true })).toBeEnabled()
  await expect(page.getByTestId('proposal')).toHaveCount(0)
  await expect(cards.nth(0)).toContainText('Selection A')
  await expect(cards.nth(0)).not.toContainText('Wrong late title')
  await expect(page.getByLabel('修改范围')).toHaveValue('document')
})
