import { expect, test, type Page } from '@playwright/test'

const boxLayout = (page: Page) => page.locator('.app > .toolbar, .workspace > .panel, .workspace > .panel-resizer, .workspace > .canvas-wrap').evaluateAll(nodes =>
  nodes.map(node => {
    const { x, y, width, height } = node.getBoundingClientRect()
    return { x, y, width, height }
  }),
)
const toolbarOrder = (page: Page) => page.locator('.toolbar > button').evaluateAll(nodes =>
  nodes.map(node => node.getAttribute('data-testid') || node.getAttribute('title') || node.textContent),
)
const articleCard = (page: Page) => page.locator('.article [data-block-type="card"] .block-html')
const articleStyle = (page: Page) => articleCard(page).first().evaluate(node => {
  const css = getComputedStyle(node)
  return [css.color, css.fontFamily, css.fontSize, css.backgroundColor, node.innerHTML]
})
async function createScaffoldProject(page: Page) {
  await page.getByTestId('tab-projects').click()
  const created = page.waitForResponse(response => response.request().method() === 'PUT'
    && /\/api\/projects\/[^/]+$/.test(response.url()) && response.ok())
  await page.getByRole('button', { name: '新建空白项目' }).click()
  await created
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await expect(page.locator('.article [data-block-type]')).toHaveCount(4)
  await expect(articleCard(page)).toHaveCount(0)
  await page.getByTestId('tab-blocks').click()
}

async function selectTheme(page: Page, choice: string) {
  await page.getByTestId('open-data').click()
  await page.getByRole('combobox', { name: /界面主题/ }).selectOption(choice)
  if (choice === 'mono-dark') {
    await expect(page.getByTestId('data-dir')).toHaveCSS('background-color', 'rgb(37, 37, 35)')
    await expect(page.getByTestId('data-dir')).toHaveCSS('color', 'rgb(236, 236, 230)')
  }
  await page.getByRole('button', { name: '关闭', exact: true }).click()
}

test('interface themes keep upstream layout, article rendering, and preview bytes unchanged', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  await createScaffoldProject(page)
  await page.getByTestId('lib-card').click()
  await expect(articleCard(page)).toHaveCount(1)
  await expect(page.locator('html')).not.toHaveAttribute('data-ui-theme', /.+/)
  const order = await toolbarOrder(page)
  const original = await articleStyle(page)
  const desktop = await boxLayout(page)
  await page.getByTestId('open-preview').click()
  const previewSrc = await page.getByTestId('preview-frame').getAttribute('srcdoc')
  expect(previewSrc).toContain('<html')
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await selectTheme(page, 'mono-dark')
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'mono-dark')
  await expect(page.locator('.toolbar')).toHaveCSS('background-color', 'rgb(27, 27, 26)')
  await expect(page.locator('.toolbar .brand')).toHaveCSS('font-family', /Noto Serif SC Variable/)
  expect(await toolbarOrder(page)).toEqual(order)
  expect(await boxLayout(page)).toEqual(desktop)
  expect(await articleStyle(page)).toEqual(original)
  await page.getByTestId('open-preview').click()
  expect(await page.getByTestId('preview-frame').getAttribute('srcdoc')).toEqual(previewSrc)
  await page.getByRole('button', { name: '关闭', exact: true }).click()

  await selectTheme(page, 'mono-light')
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'mono-light')
  await expect(page.locator('.toolbar')).toHaveCSS('background-color', 'rgb(255, 254, 250)')
  expect(await boxLayout(page)).toEqual(desktop)
  expect(await articleStyle(page)).toEqual(original)
  await page.keyboard.press('Control+s')
  await expect(page.getByTestId('save-status')).toContainText('已保存')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'mono-light')
  await selectTheme(page, 'upstream')
  await expect(page.locator('html')).not.toHaveAttribute('data-ui-theme', /.+/)
  await expect(page.locator('.toolbar')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
})

test('monochrome dark keeps blue multiselect and upstream semantic review colors', async ({ page }, testInfo) => {
  await page.addInitScript(() => localStorage.setItem('xiumi-ui-theme', 'mono-dark'))
  await page.route('**/api/ai/status', route => route.fulfill({ json: { enabled: true, name: 'Synthetic', model: 'synthetic', provider: 'openai', profileId: 'synthetic' } }))
  await page.route('**/api/ai/suggest-instruction', route => route.fulfill({ json: { suggestion: '' } }))
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  await createScaffoldProject(page)
  for (const title of ['Multi A', 'Multi B']) {
    await page.getByTestId('lib-card').click()
    await page.getByTestId('tab-style').click()
    await page.locator('.panel.right').getByRole('textbox', { name: '标题', exact: true }).fill(title)
  }
  const cards = page.getByTestId('canvas').locator('[data-block-type="card"]')
  await cards.nth(0).locator('.block-html').click()
  await cards.nth(1).locator('.block-html').click({ modifiers: ['Control'] })
  await expect(page.locator('.article .block.selected')).toHaveCount(2)
  for (const block of await page.locator('.article .block.selected').all()) {
    await expect(block).toHaveCSS('outline-color', 'rgb(37, 99, 235)')
  }
  const deleteSelection = page.getByTestId('delete-selected-blocks')
  const clearSelection = page.getByTestId('multi-selection-properties').getByRole('button', { name: '取消选择' })
  await expect(deleteSelection).toHaveCSS('color', 'rgb(255, 159, 155)')
  await expect(clearSelection).toHaveCSS('color', 'rgb(236, 236, 230)')
  await expect(deleteSelection).toHaveCSS('background-color', 'rgb(27, 27, 26)')
  await selectTheme(page, 'mono-light')
  await expect(deleteSelection).toHaveCSS('color', 'rgb(152, 42, 54)')
  await expect(clearSelection).toHaveCSS('color', 'rgb(34, 34, 32)')
  await expect(deleteSelection).toHaveCSS('background-color', 'rgb(255, 254, 250)')
  await selectTheme(page, 'mono-dark')
  await page.route('**/api/ai/edit', route => {
    const { selectedIds } = route.request().postDataJSON()
    return route.fulfill({ json: { summary: 'Selected pair', selectionPolicy: 'filter', ignoredOps: 0, ops: selectedIds.map((id: string, index: number) => ({ op: 'update', id, props: { title: `Accepted ${index}` } })) } })
  })
  await page.getByTestId('tab-ai').click()
  const modelStatus = page.locator('.panel.right .ai-status.on')
  await expect(modelStatus).toContainText('Synthetic')
  await expect(modelStatus).toHaveCSS('background-color', 'rgb(32, 45, 36)')
  await expect(modelStatus).toHaveCSS('color', 'rgb(165, 207, 172)')
  await page.getByLabel('AI 修改指令').fill('只修改所选模块标题')
  await page.getByRole('button', { name: '生成修改建议', exact: true }).click()
  await expect(page.locator('.review-suggestion')).toHaveCount(2)
  const summary = page.getByTestId('proposal')
  await expect(summary).toContainText('Selected pair')
  await expect(summary).toHaveCSS('background-color', 'rgb(37, 37, 35)')
  await expect(summary.getByText('Selected pair')).toHaveCSS('color', 'rgb(236, 236, 230)')
  await expect(summary.getByTestId('review-progress')).toHaveCSS('color', 'rgb(165, 165, 158)')
  await expect(page.locator('.review-original-label').first()).toHaveCSS('color', 'rgb(140, 24, 40)')
  await expect(page.locator('.review-suggestion').first()).toHaveCSS('color', 'rgb(18, 62, 36)')
  await expect(page.locator('.review-accept').first()).toHaveCSS('background-color', 'rgb(23, 102, 56)')
  await expect(page.locator('.review-reject').first()).toHaveCSS('background-color', 'rgb(161, 29, 48)')
  await page.screenshot({ path: testInfo.outputPath('mono-dark-review-and-multiselect.png') })
  await page.locator('.review-accept').first().click()
  await page.locator('.review-reject').first().click()
  await expect(cards.nth(0)).toContainText('Accepted 0')
  await expect(cards.nth(1)).toContainText('Multi B')
})

test('dark selects and edits a nested module in blue without recoloring authored borders', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('xiumi-ui-theme', 'mono-dark'))
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="100"><rect width="180" height="100" fill="#778899"/></svg>'
  await page.route('**/media/theme-outline.png*', route => route.fulfill({ contentType: 'image/svg+xml', body: svg }))
  const id = 'theme-outline-' + String(Date.now())
  const title = 'Outline isolation fixture'
  const at = Date.now()
  const blocks = [
    { id: 'outline-box', type: 'box', props: { title: '文本框', label: '', variant: 'paper', children: [
      { id: 'outline-child', type: 'heading', props: { title: '框内标题', index: '', subtitle: '', variant: 'auto' } },
    ] } },
    { id: 'outline-html', type: 'html', props: { html: '<section><p style="border:2px solid #111111">原有黑色边框</p><img src="/media/theme-outline.png" alt="合成图像"></section>', label: '保留原样' } },
  ]
  const saved = await page.request.put('/api/projects/' + id, { data: { id, title, author: '', digest: '', themeId: 'minimal-magazine', blocks, createdAt: at, updatedAt: at } })
  expect(saved.ok()).toBe(true)
  await page.route('**/api/projects', route => route.fulfill({ json: [{ id, title }] }))
  await page.goto('/')
  await expect(page.locator('.title-input')).toHaveValue(title)
  await expect(page.locator('html')).toHaveAttribute('data-ui-theme', 'mono-dark')
  const child = page.locator('.box-body [data-block-id="outline-child"]')
  await child.locator('.block-html').click()
  await expect(child).toHaveCSS('outline-color', 'rgb(37, 99, 235)')
  await child.hover()
  await expect(child).toHaveCSS('outline-color', 'rgb(37, 99, 235)')
  await child.locator('.block-html').dblclick()
  await expect(child.getByTestId('inline-block-text')).toBeVisible()
  await expect(child).toHaveCSS('outline-color', 'rgb(37, 99, 235)')
  await page.keyboard.press('Escape')
  const authored = page.locator('[data-block-id="outline-html"] .block-html')
  await authored.getByRole('img', { name: '合成图像' }).click()
  await expect(page.getByTestId('image-resize-overlay')).toHaveCSS('border-top-color', 'rgb(37, 99, 235)')
  await expect(authored.getByText('原有黑色边框')).toHaveCSS('border-top-color', 'rgb(17, 17, 17)')
  await expect(page.locator('.block-select, .block-select-toggle')).toHaveCount(0)
})

for (const mode of ['upstream', 'mono-light', 'mono-dark']) {
  test(`compact workspace keeps canvas and all upstream actions reachable (${mode})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.addInitScript(theme => localStorage.setItem('xiumi-ui-theme', theme), mode)
    await page.goto('/')
    const switcher = page.getByRole('navigation', { name: '工作区切换' })
    await expect(switcher).toBeVisible()
    expect((await page.getByTestId('canvas').boundingBox())!.width).toBeGreaterThan(250)
    await switcher.getByRole('button', { name: '资源' }).click()
    await expect(page.getByTestId('tab-blocks')).toBeVisible()
    await switcher.getByRole('button', { name: '属性' }).click()
    await expect(page.getByTestId('tab-style')).toBeVisible()
    await switcher.getByRole('button', { name: '画布' }).click()
    await expect(page.getByTestId('canvas')).toBeVisible()
    await page.getByRole('button', { name: '更多', exact: true }).click()
    for (const id of ['open-preview', 'open-ai-settings', 'open-article-import', 'open-import', 'open-export', 'open-data']) {
      await expect(page.getByTestId(id)).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
}

test('compact workspace keeps keyboard focus visible after a desktop resize', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const switcher = page.getByRole('navigation', { name: '工作区切换' })
  await switcher.getByRole('button', { name: '资源' }).click()
  await expect(page.getByTestId('tab-blocks')).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(switcher).toBeHidden()
  const zoom = page.getByTestId('zoom-in')
  await zoom.focus()
  await expect(zoom).toBeFocused()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(switcher.getByRole('button', { name: '画布' })).toHaveAttribute('aria-pressed', 'true')
  await expect(zoom).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('zoom-reset')).toHaveText('110%')
})
