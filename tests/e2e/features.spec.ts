// 新功能 E2E：AI 模型设置 + AI 设计（本地模拟 OpenAI 兼容服务）、导入公众号推文并保存为模板
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

const MOCK_PORT = 5298
const PRIMARY = ['#7a1f2b', '#1d4e5f', '#3f3a8c']
let mock: Server
const calls: string[] = []
let placeRequest = ''

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

/** 模拟模型写的文案：带标题级别 */
const COPY = ['# AI 文案标题', '副标题：模拟副标题', '导语第一段，现场的灯亮了起来。', '## 开幕式', 'AI 文案正文一，五个院系的同学完成了光的接力。', '## 创客市集', 'AI 文案正文二，四十二个摊位。', '文字：测试宣传部'].join('\n\n')

/** 模拟模型安排照片：含照片 3 的单元放在“正文一”后面，其余放在导语后 */
function placePlan(user: string) {
  const units: any[] = JSON.parse(user.split('照片单元：\n')[1]?.split('\n\n可用版式')[0] ?? '[]')
  return { placements: units.map((u) => ({ photos: u.photos, after: u.photos.includes(3) ? 'P3' : 'P1' })) }
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
      if (sys.includes('照片放在文章哪一段')) placeRequest = user
      const content = sys.includes('照片放在文章哪一段') ? placePlan(user) : sys.includes('主笔') ? { markdown: COPY } : sys.includes('视觉设计师') ? designs() : sys.includes('主编') ? { sections: [] } : { ok: true, model: 'mock' }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }))
    })
  })
  await new Promise<void>((r) => mock.listen(MOCK_PORT, '127.0.0.1', r))
})
test.afterAll(() => mock.close())

test('配置 AI 模型并生成三套 AI 设计方案', async ({ page }) => {
  await page.goto('/')
  // 测试服务器刚启动时可能还在预构建依赖并刷新页面：等页面稳定后再操作
  await page.waitForLoadState('networkidle')
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

  // 就地编辑时点击图片即选中（相框一起），可直接删除
  const imgs = page.locator('[data-testid=canvas] img')
  const before = await imgs.count()
  await blocks.filter({ has: page.locator('img') }).first().dblclick()
  await page.locator('.html-editor img').first().dispatchEvent('click')
  await expect(page.locator('.html-editor .media-picked')).toHaveCount(1)
  await page.getByTestId('delete-picked').click()
  await page.getByRole('button', { name: '完成' }).click()
  await expect(imgs).toHaveCount(before - 1)

  // 模板列表中出现导入的模板，可用其新建项目
  await page.getByRole('button', { name: '模板', exact: true }).click()
  await expect(page.getByTestId('template-item').first()).toContainText('测试推文：社团招新季')
  await page.getByRole('button', { name: '新建', exact: true }).first().click()
  await expect(page.locator('.toast')).toContainText('已用模板')
  await expect(page.getByTestId('canvas')).toContainText('社团招新季')
})

test('粘贴整页复制的富文本：去掉页面外框，版面随画布宽度缩放', async ({ page }) => {
  const fixture = readFileSync(join(import.meta.dirname, '..', 'fixtures', 'pasted-reader-page.html'), 'utf8')
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
  // 标题栏、阅读数、扫码面板不算版块；标题取自页面标题栏
  await expect(page.getByText(/识别到 3 个版块/)).toBeVisible()
  await expect(page.locator('.modal label.field input').first()).toHaveValue('夏季运动会报名通知')
  // 不存模板：后面的用例按“最近保存的模板”取模板
  await page.getByLabel('同时保存为模板').uncheck()
  await page.getByTestId('article-authorized').check()
  await page.getByTestId('article-import').click()
  await expect(page.locator('.toast')).toContainText('已导入 3 个原文片段')

  const canvas = page.getByTestId('canvas')
  await expect(canvas.locator('[data-block-type=html]')).toHaveCount(3)
  await expect(canvas).not.toContainText('投诉')
  const m = await canvas.evaluate((el) => {
    const rect = (n: Element) => n.getBoundingClientRect()
    const block = rect(el.querySelector('[data-block-type=html]')!)
    const grid = rect(el.querySelector('section[style*="display: grid"]')!)
    const deco = rect(el.querySelector('img[src*="DECOright01"]')!.parentElement!.parentElement!)
    const cols = [...el.querySelectorAll('section[style*="inline-block"]')].map(rect)
    const widest = Math.max(...[...el.querySelectorAll('[data-block-type=html] *')].map((n) => rect(n).right))
    return { block: block.width, blockRight: block.right, grid: grid.width, ratio: grid.width / grid.height, deco: deco.width / grid.width, decoGap: grid.right - deco.right, decoTop: (deco.top - grid.top) / grid.width, colTops: cols.map((c) => c.top), colWidth: cols[0].width / grid.width, widest }
  })
  // 来源栏宽是 600px，画布不是：版面按比例缩放，装饰仍贴着右边，两栏仍并排
  expect(Math.abs(m.block - 600)).toBeGreaterThan(10)
  expect(Math.abs(m.grid - m.block)).toBeLessThan(1.5)
  expect(m.ratio).toBeCloseTo(1.5, 1)
  expect(m.deco).toBeCloseTo(108.5 / 600, 2)
  expect(Math.abs(m.decoGap)).toBeLessThan(1.5)
  expect(m.decoTop).toBeCloseTo(51.1875 / 600, 2)
  expect(Math.abs(m.colTops[0] - m.colTops[1])).toBeLessThan(1.5)
  expect(m.colWidth).toBeCloseTo(0.5, 2)
  expect(m.widest).toBeLessThanOrEqual(m.blockRight + 1.5)
})

test('AI 写文案、按标准名称套用模板模块并安排照片，再按槽位改字', async ({ page }, testInfo) => {
  page.on('dialog', (d) => d.accept())
  await page.goto('/')
  await page.getByRole('button', { name: '模板', exact: true }).click()
  // 模板的模块：每个模块都有标准名称，可以确认保存
  await page.getByTestId('template-modules').first().click()
  await expect(page.getByTestId('template-module').first()).toBeVisible()
  await expect(page.getByTestId('module-role-0')).toHaveValue('cover')
  await page.getByTestId('save-module-roles').click()
  await expect(page.locator('.toast')).toContainText('已保存模块的标准名称')

  await page.getByTestId('apply-template').first().click()
  await expect(page.getByTestId('pick-template').first().locator('..')).toHaveClass(/\bon\b/)
  await expect(page.getByTestId('kit-table')).toContainText('封面标题')
  await page.getByTestId('load-sample').click()
  await expect(page.locator('.import-step .hint').first()).toContainText('图片 10 张')

  // 一键生成文案：带标题级别，导入正文框
  await page.getByTestId('open-copywriter').click()
  await page.getByTestId('cw-brief').fill('秋季科技文化节，开幕式和创客市集')
  await page.getByTestId('cw-generate').click()
  await expect(page.getByTestId('cw-result')).toHaveValue(/## 开幕式/)
  await expect(page.getByTestId('cw-check')).toContainText('一级标题 2 个')
  await page.getByTestId('cw-import').click()
  await expect(page.getByTestId('import-text')).toHaveValue(/^# AI 文案标题/)

  // 照片：描述随请求发给模型；两张照片指定放在同一句后面时先确认怎么排
  await expect(page.getByTestId('photo-notes').locator('li')).toHaveCount(10)
  const fileOf = async (i: number) => (await page.getByTestId('photo-notes').locator('li img').nth(i).getAttribute('src'))!.split('?')[0]
  const [p1, p3] = [await fileOf(0), await fileOf(2)]
  await page.getByTestId('photo-note-3').fill('开幕式全体合影')
  await page.getByTestId('photo-anchor-1').fill('四十二个摊位')
  await page.getByTestId('photo-anchor-2').fill('四十二个摊位')
  // 组成一组后，在组员那一行也能指定整组的位置
  await page.getByTestId('photo-pick-9').check()
  await page.getByTestId('photo-pick-10').check()
  await page.getByTestId('make-group').click()
  await page.getByTestId('photo-anchor-10').fill('导语第一段')
  await expect(page.getByTestId('group-anchor')).toHaveValue('导语第一段')
  await expect(page.getByTestId('photo-anchor-9')).toHaveValue('导语第一段')
  await expect(page.getByTestId('photo-notes').locator('.anchor .ok').first()).toBeVisible()
  await expect(page.getByTestId('generate')).toHaveText('套用模板生成')
  await page.getByTestId('generate').click()
  // 写了照片描述：先问是否按照片补充文案（补充流程见 enrich.spec.ts），这里不改
  await expect(page.getByTestId('enrich-ask')).toContainText('1 张照片写了描述')
  await page.getByTestId('enrich-no').click()
  // 这个模板没有单独的标题模块：文案的一级标题超出，需要先处理
  await expect(page.getByTestId('issue-levels')).toContainText('所选模块只有 0 级标题模块')
  await expect(page.getByTestId('plan-continue')).toBeDisabled()
  await page.getByTestId('flatten-levels').click()
  await expect(page.getByTestId('import-text')).toHaveValue(/\*\*开幕式\*\*/)
  await expect(page.getByTestId('issue-crowded')).toContainText('照片 1、2')
  await page.getByTestId('crowd-singles').check()
  // 模板里没有双图版式：这一组改为单图依次排列
  await expect(page.getByTestId('issue-nolayout')).toContainText('照片 9、10')
  await page.getByTestId('issue-nolayout').locator('input').check()
  await page.getByTestId('plan-continue').click()

  const card = page.locator('[data-testid^="variant-kit-"]')
  await expect(card).toHaveCount(1)
  const preview = card.locator('.mini-inner')
  await expect(preview).toContainText('AI 文案标题')
  await expect(preview).toContainText('AI 文案正文一')
  await expect(preview).not.toContainText('社团招新季')
  expect(calls.some((c) => c.includes('排版编辑'))).toBe(true)
  expect(placeRequest).toContain('照片3：开幕式全体合影')
  // 指定了位置的照片不交给模型
  expect(placeRequest).not.toMatch(/照片[12](?!\d)/)
  // 照片 3 放在模型指定的“正文一”之后、下一章之前；照片 1、2 在“四十二个摊位”之后
  const html = await preview.innerHTML()
  expect(html.indexOf(p3)).toBeGreaterThan(html.indexOf('AI 文案正文一'))
  expect(html.indexOf(p3)).toBeLessThan(html.indexOf('创客市集'))
  expect(html.indexOf(p1)).toBeGreaterThan(html.indexOf('四十二个摊位'))
  // 结果较多时弹窗不超出窗口，内容区可滚动
  const modal = (await page.locator('.modal').boundingBox())!
  expect(modal.y + modal.height).toBeLessThanOrEqual(900)
  expect(await page.locator('.modal-body').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
  await card.getByRole('button', { name: '使用此方案' }).click()
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })

  // 选中原文片段，在右侧按槽位改字，保留原样式
  await page.locator('[data-testid=canvas] [data-block-type=html]').first().click()
  await page.getByTestId('slot-t0').locator('textarea').fill('新的封面标题')
  await expect(page.getByTestId('canvas')).toContainText('新的封面标题')
  expect(await page.getByTestId('canvas').innerHTML()).toContain('#f3eefa')

  // 把一张照片拖到另一张照片上，两张交换位置
  const photos = page.locator('[data-testid=canvas] img[data-photo]')
  const base = async (i: number) => (await photos.nth(i).getAttribute('src'))!.split('?')[0]
  const first = async () => Promise.all([0, 1, 2].map(base))
  const before = await first()
  expect(new Set(before).size).toBe(3)
  // Diagnostic only: no listeners prevent default, dispatch events, or change layout.
  await page.evaluate(() => {
    const records: unknown[] = []
    const identity = (node: EventTarget | null) => {
      const el = node instanceof Element ? node : null
      return { tag: el?.tagName ?? null, blockId: el?.closest('[data-block-id]')?.getAttribute('data-block-id')?.slice(0, 96) ?? null,
        photoIndex: el?.closest('img[data-photo]')?.getAttribute('data-photo')?.slice(0, 16) ?? null }
    }
    const geometry = () => [...document.querySelectorAll('[data-testid=canvas] img[data-photo]')].slice(0, 3).map(el => {
      const r = el.getBoundingClientRect()
      return { ...identity(el), x: r.x, y: r.y, width: r.width, height: r.height }
    })
    let dropped = 0
    const record = (e?: Event) => {
      if (records.length >= 120) { dropped++; return }
      const mouse = e instanceof MouseEvent ? e : null
      const transfer = e instanceof DragEvent ? e.dataTransfer : null
      let from: { blockId: string; index: number } | null = null
      try {
        const raw = transfer?.getData('application/x-xiumi-photo')
        if (raw && raw.length < 512) {
          const value = JSON.parse(raw)
          if (typeof value.blockId === 'string' && Number.isSafeInteger(value.index)) from = { blockId: value.blockId.slice(0, 96), index: value.index }
        }
      } catch { /* Protected drag data is optional diagnostic information. */ }
      records.push({ type: e?.type ?? 'setup', ...identity(e?.target ?? null),
        clientX: mouse?.clientX ?? null, clientY: mouse?.clientY ?? null,
        pointTarget: mouse ? identity(document.elementFromPoint(mouse.clientX, mouse.clientY)) : null,
        types: transfer ? [...transfer.types].slice(0, 12).map(t => t.slice(0, 96)) : [], from,
        scrollTop: document.querySelector('.canvas-scroll')?.scrollTop ?? null, photos: geometry() })
    }
    const events = ['mousedown', 'mouseup', 'dragstart', 'dragover', 'drop', 'dragend']
    events.forEach(type => document.addEventListener(type, record, { capture: true, passive: true }))
    record()
    ;(window as unknown as { readPhotoDiagnostic: () => unknown }).readPhotoDiagnostic = () => records
    ;(window as unknown as { finishPhotoDiagnostic: () => unknown }).finishPhotoDiagnostic = () => {
      events.forEach(type => document.removeEventListener(type, record, true))
      return { records, dropped, finalPhotos: geometry() }
    }
  })
  try {
    // 相邻的大图拖动时页面可能滚动，落点不一定是第二张：只要求恰好有两张互换了位置
    // Begin a real native drag before Playwright scrolls the offscreen target.
    const source = photos.nth(0)
    const destination = photos.nth(1)
    const sourceIdentity = await source.evaluate(el => ({ blockId: el.closest('[data-block-id]')!.getAttribute('data-block-id'), photoIndex: el.getAttribute('data-photo') }))
    await source.scrollIntoViewIfNeeded()
    const start = await source.boundingBox()
    expect(start).not.toBeNull()
    await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2)
    await page.mouse.down()
    await page.mouse.move(start!.x + start!.width / 2 + 16, start!.y + start!.height / 2, { steps: 4 })
    const events = () => page.evaluate(() => (window as unknown as { readPhotoDiagnostic: () => Array<{ type: string; blockId: string | null; photoIndex: string | null }> }).readPhotoDiagnostic())
    await expect.poll(async () => (await events()).filter(e => e.type === 'dragstart').map(e => ({ blockId: e.blockId, photoIndex: e.photoIndex }))).toEqual([sourceIdentity])
    await destination.scrollIntoViewIfNeeded()
    const end = await destination.boundingBox()
    expect(end).not.toBeNull()
    await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 4 })
    await page.mouse.move(end!.x + end!.width / 2 + 1, end!.y + end!.height / 2)
    await expect.poll(async () => (await events()).filter(e => e.type === 'dragover').length).toBeGreaterThan(0)
    await page.mouse.up()
    await expect.poll(async () => (await events()).filter(e => e.type === 'drop').length).toBe(1)
    await expect(page.locator('.toast')).toContainText('已交换两张照片')
    const after = await first()
    expect([...after].sort()).toEqual([...before].sort())
    expect(after.filter((s, i) => s !== before[i])).toHaveLength(2)
  } finally {
    await page.mouse.up().catch(() => undefined)
    try {
      const diagnostic = await page.evaluate(() => {
        const w = window as unknown as { finishPhotoDiagnostic?: () => unknown; readPhotoDiagnostic?: () => unknown }
        const result = w.finishPhotoDiagnostic?.()
        delete w.finishPhotoDiagnostic
        delete w.readPhotoDiagnostic
        return result
      })
      await testInfo.attach('photo-drag-diagnostic', { body: JSON.stringify(diagnostic, null, 2), contentType: 'application/json' })
    } catch { console.warn('Photo drag diagnostic unavailable; original test result retained') }
  }
})
