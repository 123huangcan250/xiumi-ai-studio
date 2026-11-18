// 工作区：只缩放文章不缩放界面、拖动调整侧栏宽度、右侧栏改文字保留空格并设对齐、AI 只改选中的模块
import { expect, test, type Page } from '@playwright/test'
import { scopeEditResult } from '../../server/aiEdit'

const rich = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const para = (id: string, text: string) => ({ id, type: 'paragraph', props: { content: rich(text), align: 'justify' } })

async function seed(page: Page, name: string, blocks: unknown[]) {
  const now = Date.now()
  const id = `ws-${now}-${Math.floor(Math.random() * 1e6)}`
  const res = await page.request.put(`/api/projects/${id}`, { data: { id, title: name, author: '', digest: '', themeId: 'minimal-magazine', createdAt: now, updatedAt: now, blocks } })
  expect(res.ok(), await res.text()).toBe(true)
  await page.goto('/')
  await page.evaluate(() => ['xiumi-canvas-zoom', 'xiumi-panel-widths'].forEach((k) => localStorage.removeItem(k)))
  await page.reload()
  await expect(page.locator('.title-input')).toHaveValue(name)
}

test('只缩放文章，不缩放界面；侧栏宽度可以拖动并记住', async ({ page }) => {
  await seed(page, '缩放测试', [para('a', '第一段')])
  const phone = page.locator('.phone')
  const toolbar = page.locator('.toolbar')
  const left = page.locator('.panel.left')
  const w0 = (await phone.boundingBox())!.width
  const toolbar0 = (await toolbar.boundingBox())!.height
  const left0 = (await left.boundingBox())!.width

  await page.keyboard.press('Control+Equal')
  await page.keyboard.press('Control+Equal')
  await expect(phone).toHaveAttribute('data-zoom', '1.2')
  expect((await phone.boundingBox())!.width).toBeCloseTo(w0 * 1.2, 0)
  // 界面其他部分不变：浏览器自己的缩放没有被触发
  expect((await toolbar.boundingBox())!.height).toBe(toolbar0)
  expect((await left.boundingBox())!.width).toBe(left0)
  expect(await page.evaluate(() => devicePixelRatio)).toBe(1)

  // Ctrl + 滚轮缩放文章，且不会让浏览器缩放整个页面
  const prevented = await page.evaluate(() => {
    const ev = new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true })
    document.querySelector('.canvas-scroll')!.dispatchEvent(ev)
    return ev.defaultPrevented
  })
  expect(prevented).toBe(true)
  await expect(phone).toHaveAttribute('data-zoom', '1.09')
  await page.getByTestId('zoom-reset').click()
  await expect(phone).toHaveAttribute('data-zoom', '1')
  await page.getByTestId('zoom-in').click()
  await expect(page.getByTestId('zoom-reset')).toHaveText('110%')
  await page.reload()
  await expect(phone).toHaveAttribute('data-zoom', '1.1') // 记住了
  await page.keyboard.press('Control+0')
  await expect(phone).toHaveAttribute('data-zoom', '1')

  // 拖动左侧栏的边
  const handle = page.getByTestId('resizer-left')
  const h = (await handle.boundingBox())!
  await page.mouse.move(h.x + h.width / 2, h.y + 200)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2 + 60, h.y + 200, { steps: 6 })
  await page.mouse.move(h.x + h.width / 2 + 100, h.y + 200, { steps: 6 })
  await page.mouse.up()
  const grown = async () => Math.abs((await left.boundingBox())!.width - (left0 + 100)) <= 1
  await expect.poll(grown).toBe(true)
  await page.reload()
  await expect.poll(grown).toBe(true)
  // 右侧栏同样可以拖；双击恢复默认
  const right = page.locator('.panel.right')
  const right0 = (await right.boundingBox())!.width
  await page.getByTestId('resizer-right').focus()
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => Math.round((await right.boundingBox())!.width)).toBe(Math.round(right0 + 16))
  await page.getByTestId('resizer-left').dblclick()
  await page.getByTestId('resizer-right').dblclick()
  await expect.poll(async () => Math.round((await left.boundingBox())!.width)).toBe(Math.round(left0))
  await expect.poll(async () => Math.round((await right.boundingBox())!.width)).toBe(Math.round(right0))
  // 拖动条在侧栏和文章之间自己的一列里，不盖住文章的边缘：点文章左上角的空白处能取消选中
  const canvas = (await page.locator('.canvas-scroll').boundingBox())!
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [canvas.x + 3, canvas.y + 3])
  expect(hit).toContain('canvas-scroll')
  // 文章始终留有宽度
  expect((await page.locator('.canvas-wrap').boundingBox())!.width).toBeGreaterThan(360)
})

test('右侧栏改原文片段的文字：空格保留，可设居左居中居右', async ({ page }) => {
  const html = '<section style="display: flex"><section style="display: inline-block"><p style="font-size: 20px">标题文字</p></section></section><p style="font-size: 15px">正文一段文字。</p>'
  await seed(page, '对齐测试', [{ id: 'h1', type: 'html', props: { html, label: '片段' } }])
  const block = page.locator('[data-block-id="h1"]')
  await block.click({ position: { x: 3, y: 3 } })

  const body = page.getByTestId('slot-t1').locator('textarea')
  await body.fill('    首行缩进  两个空格')
  await expect(block.locator('p').nth(1)).toHaveJSProperty('textContent', '    首行缩进  两个空格')
  await expect(body).toHaveValue('    首行缩进  两个空格') // 输入框里仍是输入的样子

  await page.getByTestId('align-t0-center').click()
  await expect(block.locator('p').first()).toHaveCSS('text-align', 'center')
  await expect(page.getByTestId('align-t0-center')).toHaveClass(/on/)
  // 外面的弹性容器也跟着居中，标题才真的在整行中间
  const box = (await block.locator('p').first().boundingBox())!
  const wrap = (await block.locator('.block-html').boundingBox())!
  expect(Math.abs(box.x + box.width / 2 - (wrap.x + wrap.width / 2))).toBeLessThan(2)
  await page.getByTestId('align-t0-right').click()
  await expect(block.locator('p').first()).toHaveCSS('text-align', 'right')
  const right = (await block.locator('p').first().boundingBox())!
  expect(Math.abs(right.x + right.width - (wrap.x + wrap.width))).toBeLessThan(2)
  await page.getByTestId('align-t0-left').click()
  await expect(page.getByTestId('align-t0-left')).toHaveClass(/on/)
})

test('默认严格策略：选中模块后混合越界建议整批拒绝', async ({ page }) => {
  await seed(page, 'AI 范围', [para('p1', '第一段内容'), para('p2', '第二段内容'), para('p3', '第三段内容')])
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { enabled: true, provider: 'openai', model: 'm', name: '测试模型', profileId: 'x' } }))
  const bodies: any[] = []
  await page.route('**/api/ai/edit', async (route) => {
    bodies.push(route.request().postDataJSON())
    await route.fulfill({
      json: {
        summary: '测试',
        ops: [
          { op: 'update', id: 'p2', props: { content: '改后的第二段' } },
          { op: 'update', id: 'p1', props: { content: '不该被改的第一段' } },
          { op: 'setMeta', title: '不该改的标题' },
        ],
      },
    })
  })
  await page.reload()
  await page.locator('[data-block-id="p2"]').click({ position: { x: 3, y: 3 } })
  await page.getByTestId('tab-ai').click()
  await expect(page.getByLabel('修改范围')).toHaveValue('selection')
  await page.getByPlaceholder(/例如：把第二章/).fill('改简洁')
  await page.getByRole('button', { name: '生成修改建议' }).click()
  await expect(page.getByTestId('proposal')).toBeVisible()
  await expect(page.locator('.review-suggestion')).toHaveCount(0)
  await expect(page.getByTestId('proposal')).toContainText('已忽略 3 条')
  await expect(page.getByTestId('proposal')).toContainText('修改其他模块不在选中的模块上')
  expect(bodies[0].context.focus).toEqual({ id: 'p2', type: 'paragraph' })
  // 其他模块只给一行摘要，选中的才给完整内容
  expect(bodies[0].context.blocks[0]).toMatchObject({ id: 'p1', summary: '第一段内容' })
  expect(bodies[0].context.blocks[0]).not.toHaveProperty('props')
  expect(bodies[0].context.blocks[1]).toHaveProperty('props')

  // 切回整篇文章：所有修改都接受
  await page.getByLabel('修改范围').selectOption('document')
  await page.getByRole('button', { name: '生成修改建议' }).click()
  await expect(page.locator('.review-suggestion')).toHaveCount(3)
  expect(bodies[1].context.focus).toBeUndefined()
})

test('过滤策略保留合规操作、显示服务端忽略数量，接受时不改其他模块', async ({ page }) => {
  await seed(page, '过滤范围', [para('p1', '第一段内容'), para('p2', '第二段内容'), para('p3', '第三段内容')])
  await page.route('**/api/ai/status', route => route.fulfill({ json: { enabled: true, provider: 'openai', model: 'm', name: '测试模型', profileId: 'x' } }))
  await page.route('**/api/ai/edit', route => {
    const body = route.request().postDataJSON()
    return route.fulfill({ json: scopeEditResult({ summary: '合规修改', ops: [
      { op: 'update', id: 'p2', props: { content: '改后的第二段' } },
      { op: 'update', id: 'p1', props: { content: '不该修改' } },
      { op: 'setMeta', title: '不该改标题' },
      { op: 'insert', index: 1, block: { type: 'paragraph', props: { content: '紧前插入' } } },
      { op: 'insert', index: 2, block: { type: 'paragraph', props: { content: '紧后插入' } } },
    ] }, body.selectedId, body.context, 'filter') })
  })
  await page.reload()
  await page.locator('[data-block-id="p2"]').click({ position: { x: 3, y: 3 } })
  await page.getByTestId('tab-ai').click()
  await page.getByLabel('AI 修改指令').fill('精简并补上前后段落')
  await page.getByRole('button', { name: '生成修改建议' }).click()
  await expect(page.locator('.review-suggestion')).toHaveCount(3)
  await expect(page.getByTestId('proposal')).toContainText('已忽略 2 条')
  await expect(page.locator('[data-block-id="p2"]')).toContainText('第二段内容')
  await page.getByTestId('accept-all').click()
  await expect(page.locator('[data-block-id="p2"]')).toContainText('改后的第二段')
  await expect(page.locator('[data-block-id="p1"]')).toContainText('第一段内容')
  await expect(page.locator('[data-block-id="p3"]')).toContainText('第三段内容')
  await expect(page.locator('.title-input')).toHaveValue('过滤范围')
  const texts = await page.locator('.phone [data-block-id]').allTextContents()
  expect(texts.join('|')).toMatch(/第一段内容[\s\S]*紧前插入[\s\S]*改后的第二段[\s\S]*紧后插入[\s\S]*第三段内容/)
})

test('过滤策略允许文本框内子模块更新和删除，但不改框外内容', async ({ page }) => {
  await seed(page, '框内范围', [para('outside', '框外保持不变'), { id: 'box', type: 'box', props: { title: '选中的文本框', label: '', variant: 'plate', children: [para('child', '框内原文'), para('sibling', '框内可删除')] } }])
  await page.route('**/api/ai/status', route => route.fulfill({ json: { enabled: true, provider: 'openai', model: 'm', name: '测试模型', profileId: 'x' } }))
  await page.route('**/api/ai/edit', route => {
    const body = route.request().postDataJSON()
    return route.fulfill({ json: scopeEditResult({ summary: '精简文本框', ops: [
      { op: 'update', id: 'child', props: { content: '框内修改成功' } },
      { op: 'remove', id: 'sibling' },
      { op: 'update', id: 'outside', props: { content: '不该修改' } },
    ] }, body.selectedId, body.context, 'filter') })
  })
  await page.reload()
  await page.locator('[data-block-id="box"]').click({ position: { x: 3, y: 3 } })
  await page.getByTestId('tab-ai').click()
  await page.getByLabel('AI 修改指令').fill('精简文本框')
  await page.getByRole('button', { name: '生成修改建议' }).click()
  await expect(page.locator('.review-suggestion')).toHaveCount(2)
  await expect(page.getByTestId('proposal')).toContainText('已忽略 1 条')
  await page.getByTestId('accept-all').click()
  await expect(page.locator('[data-block-id="child"]')).toContainText('框内修改成功')
  await expect(page.locator('[data-block-id="sibling"]')).toHaveCount(0)
  await expect(page.locator('[data-block-id="outside"]')).toContainText('框外保持不变')
})

test('AI 模型设置：从上游取模型列表和参数，检测思考强度并保存', async ({ page }) => {
  // 上游由路由模拟（服务端逻辑见单元测试）；保存请求也只截获，不写进 e2e 的设置里
  await page.route('**/api/settings/ai/models', (r) => r.fulfill({ json: { models: [{ id: 'big-model', name: 'Big', contextWindow: 262144, maxOutput: 32768 }, { id: 'plain' }] } }))
  await page.route('**/api/settings/ai/probe-effort', (r) => r.fulfill({ json: { supported: ['low', 'high'], rejected: [{ effort: 'none', message: "Invalid value 'none'" }], ignored: false } }))
  let saved: any = null
  await page.route('**/api/settings/ai', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback()
    saved = route.request().postDataJSON()
    await route.fulfill({ json: { activeId: '', profiles: [] } })
  })
  await page.goto('/')
  await page.getByTestId('open-ai-settings').click()
  await page.getByTestId('ai-add-preset').selectOption('custom')
  await page.getByPlaceholder('https://…/v1').fill('http://127.0.0.1:5999/v1')
  await page.getByPlaceholder('粘贴密钥').fill('test-key-123456')
  await page.getByTestId('ai-load-models').click()
  await expect(page.getByTestId('ai-model-note')).toContainText('2 个模型')
  await page.getByTestId('ai-model-picker').click()
  await expect(page.getByRole('listbox', { name: '可用模型' })).toBeVisible()

  await page.getByRole('listbox', { name: '可用模型' }).getByRole('option', { name: /^big-model/ }).click()
  await expect(page.getByTestId('ai-context')).toHaveValue('262144')
  await expect(page.getByTestId('ai-max-output')).toHaveValue('32768')
  // 还没检测时给常见值；检测后只剩模型接受的
  await page.getByTestId('ai-probe-effort').click()
  await expect(page.getByTestId('ai-effort-note')).toContainText('接受：low、high')
  await page.getByTestId('ai-effort').fill('high')
  // 额外参数不是 JSON 对象时提示
  await page.getByText('高级：额外的请求参数').click()
  await page.getByTestId('ai-extra-body').fill('[1]')
  await expect(page.getByText('不是有效的 JSON 对象')).toBeVisible()
  await page.getByTestId('ai-extra-body').fill('{"enable_thinking": false}')

  await page.getByRole('button', { name: '保存' }).click()
  await expect.poll(() => saved?.profiles?.find((p: any) => p.model === 'big-model')).toMatchObject({ model: 'big-model', reasoningEffort: 'high', efforts: ['low', 'high'], contextWindow: 262144, maxOutputTokens: 32768, extraBody: '{"enable_thinking": false}' })
})
