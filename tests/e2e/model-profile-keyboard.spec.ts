import { expect, test } from '@playwright/test'

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`keyboard editing is independent of active AI profile at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport)
    let settings = {
      activeId: 'one',
      profiles: [
        { id: 'one', name: 'Alpha', provider: 'openai', baseUrl: 'https://example.invalid/v1', apiKey: '', model: 'alpha', jsonMode: true },
        { id: 'two', name: 'Beta', provider: 'anthropic', baseUrl: 'https://example.invalid/v2', apiKey: '', model: 'beta', jsonMode: true },
      ],
    }
    await page.route('**/api/settings/ai', async route => {
      if (route.request().method() === 'PUT') settings = route.request().postDataJSON()
      await route.fulfill({ json: settings })
    })
    await page.goto('/')
    await expect(page.getByTestId('canvas')).toBeVisible()
    await page.getByTestId('open-ai-settings').click()
    const modal = page.getByRole('dialog', { name: 'AI 模型设置' })
    const alpha = modal.getByRole('radio', { name: '设为当前模型：Alpha' })
    const beta = modal.getByRole('radio', { name: '设为当前模型：Beta' })
    const edit = modal.getByRole('button', { name: '编辑模型：Beta' })
    await expect(alpha).toBeChecked()
    await expect(beta).not.toBeChecked()
    await edit.focus()
    await page.keyboard.press('Enter')
    await expect(edit).toHaveAttribute('aria-pressed', 'true')
    await expect(alpha).toBeChecked()
    await expect(modal.getByRole('group', { name: '接口类型' }).getByRole('button', { name: 'Anthropic Claude' })).toHaveAttribute('aria-pressed', 'true')
    await modal.getByRole('textbox', { name: '名称', exact: true }).fill('Beta revised')
    await modal.getByRole('button', { name: '保存', exact: true }).click()
    await expect(modal).toHaveCount(0)
    expect(settings.activeId).toBe('one')
    expect(settings.profiles.map(p => p.name)).toEqual(['Alpha', 'Beta revised'])
    await page.getByTestId('open-ai-settings').click()
    await expect(modal.getByRole('radio', { name: '设为当前模型：Alpha' })).toBeChecked()
    const revised = modal.getByRole('radio', { name: '设为当前模型：Beta revised' })
    await revised.focus()
    await page.keyboard.press('Space')
    await expect(revised).toBeChecked()
    await expect(modal.getByRole('button', { name: '编辑模型：Beta revised' })).toHaveAttribute('aria-pressed', 'false')
    await modal.getByRole('button', { name: '保存', exact: true }).click()
    await expect(modal).toHaveCount(0)
    expect(settings.activeId).toBe('two')
  })
}
