// 编辑回放：插入示例模板 → 预览器按时间点截图（视觉回归）→ 关掉光标层对比（解耦）→ 导出检查
import { expect, test, type Locator, type Page } from '@playwright/test'

// 2 倍像素截图，细节（线框、光标、文字栅格图）看得清
test.use({ deviceScaleFactor: 2 })

// 3.4 秒覆盖场景 2 收尾的 swarm（光标聚拢绕圈）
const TIMES = [0.2, 0.8, 1.5, 3, 3.4, 'end'] as const

async function seek(page: Page, t: number | 'end') {
  await page.evaluate((v) => {
    const w = window as unknown as { __replaySeek: (t: number) => void }
    w.__replaySeek(v === 'end' ? 1e6 : v)
  }, t)
  // 等 React 提交并完成 setCurrentTime 后的重绘
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

const scenes = (page: Page): Locator => page.getByTestId('replay-stage').locator(':scope > section > svg')

test('edit replay: sample template plays scene by scene, cursor layer is decoupled, lint passes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  await page.getByTestId('tab-projects').click()
  await page.getByRole('button', { name: '新建空白项目' }).click()
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })
  await page.getByTestId('tab-blocks').click()

  // 插入编辑回放并载入示例（两个场景）
  await page.getByTestId('lib-replay').click()
  const block = page.getByTestId('canvas').locator('[data-block-type="replay"]')
  await expect(block).toHaveCount(1)
  page.once('dialog', (d) => d.accept())
  await page.getByTestId('rp-sample').click()
  await expect(page.getByTestId('rp-scene-tab')).toHaveCount(2)
  await expect(block.locator('svg')).toHaveCount(2)
  // 默认用栅格图输出文字（浏览器 canvas），不出现 <text>
  await expect(block.locator('svg text')).toHaveCount(0)
  expect(await block.locator('svg image').count()).toBeGreaterThan(20)

  // 属性面板：添加元素、换预设、拖拽排序（只改场景 2 的副本，最后撤销回示例）
  await page.getByTestId('rp-scene-tab').nth(1).click()
  const items = page.getByTestId('rp-item')
  await expect(items).toHaveCount(6)
  await page.getByTestId('rp-add-stat').click()
  await expect(items).toHaveCount(7)
  await items.nth(6).getByTestId('rp-preset').selectOption('alert-box')
  await expect(items.nth(0).locator('strong')).toHaveText('副标题')
  const from = (await items.nth(1).locator('.rp-handle').boundingBox())!
  const to = (await items.nth(0).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 10, from.y - 10, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 10 })
  await page.mouse.up()
  await expect(items.nth(0).locator('strong')).toHaveText('正文')
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '撤销' }).click()
  await expect(items).toHaveCount(6)
  await expect(items.nth(0).locator('strong')).toHaveText('副标题')

  await page.getByTestId('rp-preview').click()
  await expect(scenes(page)).toHaveCount(2)
  // 示例模板：零错误（只有“未选图”“内嵌图片待验证”这类提示）
  await expect(page.locator('.replay-issues .error')).toHaveCount(0)
  const stats = await page.locator('.replay-stats').textContent()
  for (const m of stats!.matchAll(/(\d+\.\d+)s 完成/g)) expect(Number(m[1])).toBeLessThanOrEqual(6)

  // 关键时间点截图（基线）
  for (const t of TIMES) {
    await seek(page, t)
    for (let i = 0; i < 2; i++) await expect(scenes(page).nth(i)).toHaveScreenshot(`replay-s${i + 1}-t${t}.png`)
  }

  // 解耦：关掉光标层重新渲染的结果，与“带光标层渲染后删掉光标层”逐像素一致
  for (const t of TIMES) {
    await page.getByTestId('replay-cursors').uncheck()
    await seek(page, t)
    const off = [await scenes(page).nth(0).screenshot(), await scenes(page).nth(1).screenshot()]
    await page.getByTestId('replay-cursors').check()
    await seek(page, t)
    await page.evaluate(() => document.querySelectorAll('[data-testid=replay-stage] > section > svg').forEach((svg) => svg.lastElementChild!.remove()))
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const stripped = [await scenes(page).nth(0).screenshot(), await scenes(page).nth(1).screenshot()]
    expect(Buffer.compare(off[0], stripped[0]), `场景 1 在 ${t} 秒`).toBe(0)
    expect(Buffer.compare(off[1], stripped[1]), `场景 2 在 ${t} 秒`).toBe(0)
  }
  await page.keyboard.press('Escape')

  // 导出：内嵌图片可以复制；本机地址会被 wechat-svg-lint 拦下
  await page.getByTestId('open-export').click()
  await page.getByRole('button', { name: '原图链接' }).click()
  await page.getByTestId('copy-wechat').click()
  await expect(page.locator('.toast')).toContainText('编辑回放未通过检查')
  await expect(page.locator('.report .warn').filter({ hasText: '编辑回放 ✕' }).first()).toBeVisible()
  // 文字栅格图已先存成本地素材（/media/rp-*.png），再换成本机绝对地址，因此被识别为本机图片
  await expect(page.locator('.report .warn').filter({ hasText: /有 \d{2,} 张图片还是本机地址/ })).toHaveCount(1)
  await page.getByRole('button', { name: '内嵌图片' }).click()
  await page.getByTestId('copy-wechat').click()
  await expect(page.locator('.toast')).toContainText('已复制')
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    return (await items[0].getType('text/html')).text()
  })
  expect(html).toContain('<svg')
  expect(html).not.toMatch(/<script|<style|\sclass=|\sid=|url\(#|foreignObject|animateMotion/)
  expect(html).toContain('<animate')
})
