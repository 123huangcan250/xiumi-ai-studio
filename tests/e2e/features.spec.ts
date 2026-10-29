// 新功能 E2E：AI 模型设置 + AI 设计（本地模拟 OpenAI 兼容服务）、导入公众号推文并保存为模板
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const MOCK_PORT = 5298
const PRIMARY = ['#7a1f2b', '#1d4e5f', '#3f3a8c']
let mock: Server
const calls: string[] = []

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

test.beforeAll(async () => {
  // 最小的 OpenAI 兼容服务：按系统提示词返回不同 JSON
  mock = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const sys = JSON.parse(body || '{}').messages?.[0]?.content ?? ''
      calls.push(sys.slice(0, 40))
      const content = sys.includes('视觉设计师') ? designs() : sys.includes('主编') ? { sections: [] } : { ok: true, model: 'mock' }
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
