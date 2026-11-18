import { expect, test } from '@playwright/test'

test('discovers custom models, imports context and keeps manual reasoning settings', async ({ page, request }) => {
  const original = await (await request.get('/api/settings/ai')).json()
  try {
    await page.route('**/api/settings/ai/models', (route) => route.fulfill({ json: [{ id: 'custom-reasoner', contextWindow: 128000, efforts: ['low', 'high'] }] }))
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.getByTestId('open-ai-settings').click()
    await page.getByTestId('ai-add-preset').selectOption('custom')
    await page.getByLabel('名称', { exact: true }).fill('Discovery test')
    await page.getByPlaceholder('https://…/v1').fill('https://example.com/v1')
    await page.getByRole('button', { name: '从服务商获取模型列表' }).click()
    await expect(page.getByRole('dialog', { name: 'AI 模型设置' }).getByRole('status')).toContainText('已获取 1 个模型')
    await page.getByTestId('ai-model-picker').click()
    const models = page.getByRole('listbox', { name: '可用模型' })
    await expect(models).toBeVisible()
    await expect(models.getByRole('option', { name: 'custom-reasoner（128000 tokens）' })).toBeAttached()
    await models.getByRole('option', { name: 'custom-reasoner（128000 tokens）' }).click()
    await expect(page.getByPlaceholder(/例如 deepseek-chat/)).toHaveValue('custom-reasoner')
    await expect(page.getByLabel('上下文窗口', { exact: false })).toHaveValue('128000')
    await page.getByLabel('思考强度', { exact: false }).fill('high')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByTestId('open-ai-settings').click()
    await page.getByText('Discovery test', { exact: true }).click()
    await expect(page.getByLabel('思考强度', { exact: false })).toHaveValue('high')
    await expect(page.getByLabel('上下文窗口', { exact: false })).toHaveValue('128000')
  } finally {
    // The suite shares one disposable API server. Do not leave our custom
    // profile selected for the later mock-model feature tests.
    const restored = await request.put('/api/settings/ai', { data: original })
    expect(restored.ok()).toBe(true)
  }
})

test('selected paragraph is sent as scope and whole-document scope remains opt-in', async ({ page }) => {
  await page.route('**/api/ai/status', (route) => route.fulfill({ json: { enabled: true, name: 'Mock', model: 'mock' } }))
  const requests: any[] = []
  await page.route('**/api/ai/edit', (route) => {
    requests.push(route.request().postDataJSON())
    return route.fulfill({ json: { summary: '建议', ops: [] } })
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('open-import').click()
  await page.getByTestId('load-sample').click()
  await page.getByTestId('use-ai').uncheck()
  await page.getByTestId('generate').click()
  await page.getByTestId('choose-narrative').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('[data-testid=canvas] [data-block-type=paragraph]').first().click()
  await page.getByTestId('tab-ai').click()
  await expect(page.getByLabel('修改范围')).toHaveValue('selection')
  await page.getByPlaceholder(/例如：把第二章/).fill('润色这段')
  await page.getByRole('button', { name: '生成修改建议', exact: true }).click()
  await expect.poll(() => requests.length).toBe(1)
  expect(requests[0].selectedId).toBeTruthy()
  expect(requests[0].context.blocks.some((b: any) => b.id === requests[0].selectedId)).toBe(true)
  await page.getByLabel('修改范围').selectOption('document')
  await page.getByRole('button', { name: '生成修改建议', exact: true }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1].selectedId).toBeUndefined()
})
