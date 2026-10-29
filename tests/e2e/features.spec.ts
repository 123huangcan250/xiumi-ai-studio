// 新功能 E2E：AI 模型设置 + AI 设计（本地模拟 OpenAI 兼容服务）、导入公众号推文并保存为模板
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const MOCK_PORT = 5298
const PRIMARY = ['#7a1f2b', '#1d4e5f', '#3f3a8c']
let mock: Server
const calls: string[] = []
let templateRequest = ''

function designs() {
  return {
    designs: PRIMARY.map((primary, i) => ({
      name: ['朱砂典雅', '深海理性', '靛紫杂志'][i],
      concept: '测试用设计方案',
      palette: { primary, accent: '#c8a44d' },
      type: { headingFont: i === 1 ? 'sans' : 'serif', fontSize: 15 },
      styles: { cover: ['band', 'hero', 'minimal'][i], heading: ['underline', 'bar', 'number'][i], quote: 'line', card: 'fill', divider: 'ornament' },
      sections: Array.from({ length: 7 }, (_, k) => ({ layout: ['imageText', 'cards', 'galleryLead', 'timeline'][(k + i) % 4], images: 1 })),
    })),
  }
}

/** 模拟模型套用模板：用到模板里除装饰外的每个部件，文字全部换成标记文字，照片按顺序分配 */
function templatePlan(user: string) {
  const catalog: any[] = JSON.parse(user.split('模板部件：\n')[1]?.split('\n\n用户的额外要求')[0] ?? '[]')
  let photo = 1 // 照片编号从 1 开始
  const parts = catalog
    .filter((p) => p.id.startsWith('p') && p.kind !== 'decor')
    .map((p, k) => ({
      part: p.id,
      text: Object.fromEntries(p.texts.map((t: any) => [t.id, t.role === 'label' ? null : `AI 文案 ${k}-${t.id}`])),
      images: Array.from({ length: typeof p.images === 'number' ? p.images : 0 }, () => photo++),
    }))
  return { title: 'AI 套用标题', digest: '模拟摘要', parts }
}

test.beforeAll(async () => {
  // 最小的 OpenAI 兼容服务：按系统提示词返回不同 JSON
  mock = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const sys = JSON.parse(body || '{}').messages?.[0]?.content ?? ''
      calls.push(sys.slice(0, 40))
      const user = JSON.parse(body || '{}').messages?.[1]?.content ?? ''
      if (sys.includes('模板部件')) templateRequest = user
      const content = sys.includes('模板部件') ? templatePlan(user) : sys.includes('视觉设计师') ? designs() : sys.includes('主编') ? { sections: [] } : { ok: true, model: 'mock' }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }))
    })
  })
  await new Promise<void>((r) => mock.listen(MOCK_PORT, '127.0.0.1', r))
})
test.afterAll(() => mock.close())

test('配置 AI 模型并生成三套 AI 设计方案', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('open-ai-settings').click()
  await page.getByTestId('ai-add-preset').selectOption('custom')
  await page.getByLabel('名称', { exact: true }).fill('本地模拟模型')
  await page.getByPlaceholder('https://…/v1').fill(`http://127.0.0.1:${MOCK_PORT}/v1`)
  await page.getByPlaceholder('粘贴密钥').fill('test-key-123456')
  await page.getByPlaceholder(/例如 deepseek-chat/).fill('mock-model')
  await page.getByRole('button', { name: '测试连接' }).click()
  await expect(page.getByText('✓ 连接成功')).toBeVisible()
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.toast')).toContainText('已保存')

  await page.getByTestId('open-import').click()
  await page.getByTestId('load-sample').click()
  await expect(page.locator('.import-step .hint').first()).toContainText('图片 10 张')
  await expect(page.getByTestId('use-ai')).toBeChecked()
  await page.getByTestId('design-hint').fill('庄重典雅')
  await page.getByTestId('generate').click()

  const aiCards = page.locator('[data-testid^="variant-ai-"]')
  await expect(aiCards).toHaveCount(3)
  await expect(aiCards.first()).toContainText('朱砂典雅')
  await expect(page.locator('[data-testid^="variant-"]')).toHaveCount(6) // 3 AI + 3 内置
  // 三套 AI 方案使用各自的主色
  for (let i = 0; i < 3; i++) await expect(aiCards.nth(i).locator('.mini-inner')).toContainText(/./)
  const html = await aiCards.nth(0).locator('.mini-inner').innerHTML()
  expect(html.toLowerCase()).toContain(PRIMARY[0])

  await aiCards.nth(0).getByRole('button', { name: '使用此方案' }).click()
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })
  expect((await page.getByTestId('canvas').innerHTML()).toLowerCase()).toContain(PRIMARY[0])
  expect(calls.some((c) => c.includes('视觉设计师'))).toBe(true)
})

test('粘贴公众号推文，保留原样式导入并保存为模板', async ({ page }) => {
  const fixture = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'wechat-article.html'), 'utf8')
  await page.goto('/')
  await page.getByTestId('open-article-import').click()
  await page.getByRole('button', { name: '粘贴富文本' }).click()
  const box = page.getByTestId('article-paste')
  await box.click()
  await box.evaluate((el, html) => {
    const dt = new DataTransfer()
    dt.setData('text/html', html)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, fixture)
  await expect(page.getByText(/识别到 \d+ 个版块/)).toBeVisible()
  const importBtn = page.getByTestId('article-import')
  await expect(importBtn).toBeDisabled() // 未确认版权前不可导入
  await page.getByTestId('article-authorized').check()
  await importBtn.click()
  await expect(page.locator('.toast')).toContainText('并保存为模板')

  const blocks = page.locator('[data-testid=canvas] [data-block-type=html]')
  expect(await blocks.count()).toBeGreaterThanOrEqual(5)
  await expect(page.getByTestId('canvas')).toContainText('社团招新季')
  expect(await page.getByTestId('canvas').innerHTML()).not.toMatch(/<script|onclick=/)

  // 双击原文片段改字
  const first = blocks.first()
  await first.dblclick()
  const editor = page.locator('.html-editor')
  await expect(editor).toBeVisible()
  await editor.evaluate((el) => {
    const p = el.querySelector('p')!
    p.textContent = 'EDITED 招新'
  })
  await page.getByRole('button', { name: '完成' }).click()
  await expect(page.getByTestId('canvas')).toContainText('EDITED 招新')
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })

  // 模板列表中出现导入的模板，可用其新建项目
  await page.getByRole('button', { name: '模板', exact: true }).click()
  await expect(page.getByTestId('template-item').first()).toContainText('测试推文：社团招新季')
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  await expect(page.locator('.toast')).toContainText('已用模板')
  await expect(page.getByTestId('canvas')).toContainText('社团招新季')
})

test('套用导入的推文模板生成新推文，并按槽位改字', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '模板', exact: true }).click()
  await page.getByTestId('apply-template').first().click()
  await expect(page.getByTestId('pick-template').first()).toHaveClass(/\bon\b/)
  await page.getByTestId('load-sample').click()
  await expect(page.locator('.import-step .hint').first()).toContainText('图片 10 张')
  // 右侧照片清单：编号 + 描述，描述随请求发给模型
  await expect(page.getByTestId('photo-notes').locator('li')).toHaveCount(10)
  await page.getByTestId('photo-note-3').fill('开幕式全体合影')
  await expect(page.getByTestId('generate')).toHaveText('AI 套用模板')
  await page.getByTestId('generate').click()

  const cards = page.locator('[data-testid^="variant-tpl-"]')
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toContainText('AI 套用模板')
  await expect(cards.first().locator('.mini-inner')).toContainText('AI 文案')
  expect(calls.some((c) => c.includes('排版编辑'))).toBe(true)
  expect(templateRequest).toMatch(/3：photo-03\.jpg｜开幕式全体合影/)
  // 结果较多时弹窗不超出窗口，内容区可滚动
  const modal = (await page.locator('.modal').boundingBox())!
  expect(modal.y + modal.height).toBeLessThanOrEqual(900)
  expect(await page.locator('.modal-body').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

  // 规则填充：沿用模板的底色版块，换成样例文稿的标题，不残留模板旧标题
  const rule = cards.nth(1)
  const preview = rule.locator('.mini-inner')
  await expect(preview).toContainText('2026 秋季校园科技文化节圆满落幕')
  await expect(preview).not.toContainText('社团招新季')
  expect(await preview.innerHTML()).toContain('#f3eefa')
  await rule.getByRole('button', { name: '使用此方案' }).click()
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })

  // 选中原文片段，在右侧按槽位改字，保留原样式
  await page.locator('[data-testid=canvas] [data-block-type=html]').first().click()
  await page.getByTestId('slot-t0').locator('textarea').fill('新的封面标题')
  await expect(page.getByTestId('canvas')).toContainText('新的封面标题')
  expect(await page.getByTestId('canvas').innerHTML()).toContain('#f3eefa')

  // 把一张照片拖到另一张照片上，两张交换位置
  const photos = page.locator('[data-testid=canvas] img[data-photo]')
  const base = async (i: number) => (await photos.nth(i).getAttribute('src'))!.split('?')[0]
  const [a, b] = [await base(0), await base(1)]
  expect(a).not.toBe(b)
  await photos.nth(0).dragTo(photos.nth(1))
  await expect(page.locator('.toast')).toContainText('已交换两张照片')
  expect([await base(0), await base(1)]).toEqual([b, a])
})
