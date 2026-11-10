// 清华电机 · 德国实践套件：大型文本框里放入模块（点击、拖入）、填图、写图注、移出、保存后重新打开
import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'

const upload = (page: Page, n: number) =>
  page.request.post('/api/assets', { multipart: { files: { name: `kit-${n}.jpg`, mimeType: 'image/jpeg', buffer: readFileSync(`samples/photo-0${n}.jpg`) } } })

/** 用鼠标拖动（dnd-kit 需要先移动几像素才开始拖） */
async function drag(page: Page, from: Locator, to: Locator, yRatio = 0.8) {
  // 共享的测试文档可能很长：目标滚到画布中间（贴着边缘会触发拖动时的自动滚动）
  await to.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const a = (await from.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2 + 12, { steps: 4 })
  // Activating a drag expands the box drop zone and may scroll the canvas.
  // Measure the live target after that layout change, not before activation.
  await to.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  let b = (await to.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * yRatio, { steps: 12 })
  await to.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  b = (await to.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height * yRatio, { steps: 4 })
  await page.mouse.up()
}

test('kit modules: text box adapts to inserted modules, photos fill slots, layout persists', async ({ page }) => {
  await page.goto('/')
  // 其他用例也会往同一个测试数据目录上传图片：按这次上传的文件名找缩略图
  const files: string[] = []
  for (const n of [1, 2]) {
    const res = await upload(page, n)
    expect(res.ok()).toBe(true)
    files.push((await res.json())[0].file)
  }
  await page.reload()
  // 新建空白项目，不受其他用例留下的内容影响
  await page.getByTestId('tab-projects').click()
  await page.getByRole('button', { name: '新建空白项目' }).click()
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })
  await page.getByTestId('tab-blocks').click()
  const canvas = page.getByTestId('canvas')
  await expect(canvas.locator('[data-block-type="box"]')).toHaveCount(0)
  await expect(page.getByTestId('kit-section')).toBeVisible()

  await page.getByTestId('kit-theme').click()
  await page.getByTestId('kit-box').click()
  const box = canvas.locator('[data-block-type="box"]')
  await expect(box).toHaveCount(1)
  await expect(box).toContainText('TSINGHUA · EEA')

  // 选中文本框时点击“双图” → 放进框内
  await page.getByTestId('kit-photos2').click()
  const grid = box.locator('[data-block-type="photos"]')
  await expect(grid).toHaveCount(1)
  await expect(grid.locator('img[data-slot]')).toHaveCount(2)

  // 选中双图后点击素材，依次填入空位
  await page.getByTestId('tab-assets').click()
  for (const f of files) await page.locator(`.asset img[src*="${f}"]`).click()
  await expect(grid.locator('img[data-slot]')).toHaveCount(0)
  await expect(grid.locator('img')).toHaveCount(2)

  // 每张图都有图注位置，可以留空
  await expect(grid).toContainText('图注（可留空）')
  await page.getByTestId('pic-row').first().locator('input').fill('慕尼黑工业大学实验楼')
  await expect(grid).toContainText('慕尼黑工业大学实验楼')

  // 把轮播拖进文本框（放在双图下面）
  await page.getByTestId('tab-blocks').click()
  await drag(page, page.getByTestId('kit-carousel'), grid)
  await expect(box.locator('[data-block-type="carousel"]')).toHaveCount(1)
  expect(await box.locator('[data-block-id]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.blockType))).toEqual(['paragraph', 'photos', 'carousel'])

  // 文本框里不能再放文本框：选中框内模块时点击“大型文本框”，放到框外
  await page.getByTestId('kit-box').click()
  await expect(canvas.locator('[data-block-type="box"]')).toHaveCount(2)
  await expect(box.first().locator('[data-block-type="box"]')).toHaveCount(0)
  await page.getByRole('button', { name: '撤销' }).click()
  await expect(canvas.locator('[data-block-type="box"]')).toHaveCount(1)

  // 把轮播移出文本框
  await box.locator('[data-block-type="carousel"]').click()
  await page.getByTestId('move-out').click()
  await expect(box.locator('[data-block-type="carousel"]')).toHaveCount(0)
  await expect(canvas.locator('[data-block-type="carousel"]')).toHaveCount(1)

  // 保存后重新打开，结构不变
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })
  await page.reload()
  await expect(box.locator('[data-block-type="photos"] img:not([data-slot])')).toHaveCount(2)
  await expect(box).toContainText('慕尼黑工业大学实验楼')
  const list = await (await page.request.get('/api/projects')).json()
  const doc = await (await page.request.get(`/api/projects/${list[0].id}`)).json()
  expect(doc.themeId).toBe('thu-eea-de')
  const saved = doc.blocks.find((b: any) => b.type === 'box')
  expect(saved.props.children.map((c: any) => c.type)).toEqual(['paragraph', 'photos'])
  expect(saved.props.children[1].props.pics[0].caption).toBe('慕尼黑工业大学实验楼')
})
