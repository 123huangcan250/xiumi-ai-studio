// 组件库闭环：粘贴导入 → 拆分收藏 → 检索 → 跨来源混排 → 配色统一 → 换背景图 → 撤销 → 刷新保留 → 导出
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const JPG = (n: number) => `https://mmbiz.qpic.cn/sz_mmbiz_jpg/p${n}/640?wx_fmt=jpeg`
const card = (t: string, color: string) => `<section style="margin: 10px 0"><section style="display: inline-block; width: 100%; padding: 5px; border: 1px solid ${color}"><img src="${JPG(1)}" style="width: 100%"><p style="font-size: 13px; color: ${color}">${t}</p></section></section>`
const pill = (t: string, color: string) => `<section style="margin: 10px 0"><section style="display: inline-block; width: 180px; background-color: ${color}; border-radius: 20px"><p style="margin: 0; text-align: center; color: #ffffff"><strong>${t}</strong></p></section></section>`
const slide = (n: number) => `<g><foreignObject width="100%" height="100%"><svg viewBox="0 0 1080 720" style="background-image: url(&quot;${JPG(n)}&quot;); background-size: 100%"></svg></foreignObject></g>`
const carousel = `<section style="display: flex; flex-flow: row nowrap; margin: 10px 0"><section style="display: inline-block; width: 100%; background-color: #ecf6e4"><svg viewBox="0 0 1080 720" style="display: block">${slide(1)}${slide(2)}${slide(1)}</svg></section></section>`
const filler = '<p>这段正文只为凑够长度，模拟秀米里一整节图文混排的大版块，便于检验按结构拆分的效果。</p>'.repeat(120)

/** 绿色文章：一个大版块（图片卡、胶囊标题、轮播），来自秀米；另有一张秀米图床的图片和背景 */
const GREEN = `<section style="background-color: #f5fef1; font-size: 16px; letter-spacing: 1px"><section style="padding: 20px">${card('绿色图注甲', '#528065')}${pill('绿色标题', '#528065')}${filler}${card('绿色图注乙', '#528065')}${pill('绿色小结', '#528065')}${carousel}<section style="border: 1px solid #528065"><img src="https://img.xiumi.us/ok.jpg" style="width: 100%"><img src="https://img.xiumi.us/fail.jpg" style="width: 100%"></section></section></section><section powered-by="xiumi.us" style="background-image: url(https://statics.xiumi.us/paper.png); padding: 8px"><p style="color: #528065">纸纹上的绿色文字</p></section>`
/** 紫色文章：另一个模板 */
const PURPLE = `<section style="background-color: #f3eefa; padding: 12px; border-radius: 8px"><p style="font-size: 20px; color: #5b3a9c"><strong>紫色模板封面</strong></p><img src="${JPG(7)}" style="width: 100%"></section><p>普通段落不进入组件库。</p><section style="border-left: 4px solid #5b3a9c; padding: 6px 12px"><p style="color: #5b3a9c">紫色引言版块</p></section>`

async function pasteArticle(page: Page, html: string, opts: { components?: boolean; template?: boolean } = {}) {
  await page.getByTestId('open-article-import').click()
  await page.getByRole('button', { name: /粘贴富文本/ }).click()
  const box = page.getByTestId('article-paste')
  await box.click()
  await box.evaluate((el, h) => {
    const dt = new DataTransfer()
    dt.setData('text/html', h)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, html)
  await expect(page.getByText(/识别到 \d+ 个版块/)).toBeVisible()
  if (!opts.template) await page.getByText('同时保存为模板').click()
  if (opts.components) await page.getByTestId('article-components').check()
  await page.getByTestId('article-authorized').check()
}

const canvas = (page: Page) => page.getByTestId('canvas')
const waitSaved = (page: Page) => expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })
const listComponents = async (page: Page): Promise<any[]> => (await page.request.get('/api/components')).json()
const openLibrary = async (page: Page) => {
  await page.getByTestId('tab-components').click()
  await expect(page.getByTestId('component-search')).toBeVisible()
}
const insertByName = (page: Page, name: string) => page.getByTestId('component-card').filter({ hasText: name }).getByTestId('component-insert').click()

/** 读取只存储不压缩的 ZIP */
function readZip(buf: Buffer) {
  const files: Record<string, Buffer> = {}
  for (let at = 0; buf.readUInt32LE(at) === 0x04034b50; ) {
    const size = buf.readUInt32LE(at + 18)
    const nameLen = buf.readUInt16LE(at + 26)
    files[buf.subarray(at + 30, at + 30 + nameLen).toString('utf8')] = buf.subarray(at + 30 + nameLen, at + 30 + nameLen + size)
    at += 30 + nameLen + size
  }
  return files
}

test('导出给秀米：本地图片不内嵌；有接口时传微信图床，没有时给占位图和编号图片包', async ({ page }) => {
  await page.goto('/')
  const { assets } = await (await page.request.post('/api/samples/load')).json()
  const [a, b] = assets
  const now = Date.now()
  const id = `xiumi-${now}`
  const html = `<section style="border: 1px solid #528065"><img src="/media/${b.file}?fit=100%3A50&amp;w=1080" style="width: 100%"><img src="${JPG(3)}" style="width: 100%"></section><svg viewBox="0 0 1080 720" style="background-image: url(&quot;/media/${b.file}?fit=100%3A50&amp;w=1080&quot;)"></svg><section style="background-image: url(&quot;${JPG(4)}&quot;)"><p>文字</p></section>`
  const doc = { id, title: '秀米导出测试', author: '', digest: '', themeId: 'tsinghua-purple', createdAt: now, updatedAt: now, blocks: [{ id: 'b1', type: 'image', props: { image: { src: `/media/${a.file}` }, caption: '单图', variant: 'full' } }, { id: 'b2', type: 'html', props: { html, label: '片段' } }] }
  await page.request.put(`/api/projects/${id}`, { data: doc })
  await page.reload()
  await expect(page.getByTestId('canvas')).toContainText('单图')

  // 没有配置接口：占位图 + 图片包
  await page.getByTestId('open-export').click()
  const section = page.getByTestId('xiumi-section')
  await expect(section).toContainText('2 张本地图片')
  await expect(section).toContainText('不能单独选中编辑')
  await expect(section).toContainText('背景图用了本地素材')
  await expect(page.getByTestId('xiumi-upload')).toBeDisabled()
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByTestId('xiumi-package').click()])
  expect(zip.suggestedFilename()).toBe('秀米导出测试-导入秀米.zip')
  const files = readZip(readFileSync((await zip.path())!))
  expect(Object.keys(files).sort()).toEqual(['图片/01.jpg', '图片/02.jpg', '导入秀米.txt', '说明.txt'].sort())
  expect(files['图片/01.jpg'].subarray(0, 2).toString('hex')).toBe('ffd8')
  const text = files['导入秀米.txt'].toString('utf8')
  // 纯 ASCII：秀米按 GBK 读也不会乱码；中文写成实体（文字）
  expect(text).not.toMatch(/[\u0080-\u{10FFFF}]/u)
  expect(text).toContain('&#x6587;&#x5B57;')
  expect(files['说明.txt'].subarray(0, 3).toString('hex')).toBe('efbbbf')
  expect(text).not.toContain('/media/')
  expect(text).toContain(JPG(3).replace('&', '&amp;'))
  // 单图、照片、背景（同一张）共 3 处占位，都很小，避免被秀米连位置删掉
  const holders = [...text.matchAll(/data:image\/jpeg;base64,[^"&]+/g)].map((m) => m[0])
  expect(holders).toHaveLength(3)
  expect(Math.max(...holders.map((h) => h.length))).toBeLessThan(30_000)
  await page.locator('.modal-close, [aria-label="关闭"]').first().click().catch(() => {})
  await page.reload()

  // 配置了接口：全部变成微信图床地址（不请求真实的微信接口）
  await page.route('**/api/wechat/status', (route) => route.fulfill({ json: { configured: true, appid: 'wx' } }))
  let uploaded: string[] = []
  await page.route('**/api/wechat/upload-images', async (route) => {
    uploaded = route.request().postDataJSON().urls
    await route.fulfill({ json: Object.fromEntries(uploaded.map((u, i) => [u, `https://mmbiz.qpic.cn/uploaded/${i}`])) })
  })
  await page.getByTestId('open-export').click()
  const up = page.getByTestId('xiumi-upload')
  await expect(up).toBeEnabled()
  const [txt] = await Promise.all([page.waitForEvent('download'), up.click()])
  const out = readFileSync((await txt.path())!, 'utf8')
  expect(uploaded).toHaveLength(2)
  expect(out).not.toMatch(/[\u0080-\u{10FFFF}]/u)
  expect(out).not.toContain('/media/')
  expect(out).not.toContain('data:image')
  expect(out).toContain('https://mmbiz.qpic.cn/uploaded/0')
  expect(out).toMatch(/background-image: url\(&quot;https:\/\/mmbiz\.qpic\.cn\/uploaded\/1&quot;\)/)
})

test('导出给秀米：超过秀米单次导入的长度上限时按模块分成几个文件，内容不丢', async ({ page }) => {
  await page.goto('/')
  const now = Date.now()
  const id = `xiumi-long-${now}`
  // 8 个模块，每个约 2 万字符，总长超过秀米的 131072 字符上限
  const blocks = Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, type: 'html', props: { label: `模块${i}`, html: `<section style="border: 1px solid #660874"><p>第${i}节开头</p>${`<p style="color: #333333">第${i}节正文，用来凑够长度。</p>`.repeat(450)}<p>第${i}节结尾</p></section>` } }))
  await page.request.put(`/api/projects/${id}`, { data: { id, title: '长文', author: '', digest: '', themeId: 'tsinghua-purple', createdAt: now, updatedAt: now, blocks } })
  await page.reload()
  await page.getByTestId('open-export').click()
  await expect(page.getByTestId('xiumi-parts')).toContainText('将导出 2 份文件，请下载后依次导入秀米')
  // 下载前提示会导出多份文件；取消就不下载
  const prompts: string[] = []
  let downloads = 0
  page.on('download', () => downloads++)
  page.once('dialog', (d) => (prompts.push(d.message()), d.dismiss()))
  await page.getByTestId('xiumi-package').click()
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]).toContain('将导出 2 份文件')
  expect(prompts[0]).toContain('依次导入秀米')
  await expect(page.getByTestId('xiumi-package')).toBeEnabled()
  expect(downloads).toBe(0)
  page.once('dialog', (d) => d.accept())
  const [zip] = await Promise.all([page.waitForEvent('download'), page.getByTestId('xiumi-package').click()])
  expect(zip.suggestedFilename()).toBe('长文-导入秀米.zip')
  const files = readZip(readFileSync((await zip.path())!))
  expect(Object.keys(files).sort()).toEqual(['导入秀米-1.txt', '导入秀米-2.txt', '说明.txt'].sort())
  expect(files['说明.txt'].toString('utf8')).toContain('依次导入')
  const decode = (s: string) => s.replace(/&#x([0-9A-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
  const parts = ['导入秀米-1.txt', '导入秀米-2.txt'].map((n) => files[n].toString('utf8'))
  for (const p of parts) {
    expect(p).not.toMatch(/[\u0080-\u{10FFFF}]/u)
    expect(decode(p).length).toBeLessThan(131072)
  }
  // 每节的开头和结尾都在，而且按顺序
  const all = parts.map(decode).join('')
  const marks = Array.from({ length: 8 }, (_, i) => [all.indexOf(`第${i}节开头`), all.indexOf(`第${i}节结尾`)]).flat()
  expect(marks.every((m) => m >= 0)).toBe(true)
  expect(marks).toEqual([...marks].sort((a, b) => a - b))
})

test.describe.serial('组件库', () => {
  test('粘贴秀米内容：转存图片、记录来源、拆分加入组件库', async ({ page }) => {
    await page.goto('/')
    const { assets } = await (await page.request.post('/api/samples/load')).json()
    // 不向秀米发真实请求：只放行一张，另一张模拟转存失败
    const requested: string[] = []
    await page.route('**/api/assets/fetch', async (route) => {
      const { urls } = route.request().postDataJSON()
      requested.push(...urls)
      await route.fulfill({ json: urls.includes('https://img.xiumi.us/ok.jpg') ? { 'https://img.xiumi.us/ok.jpg': assets[0] } : {} })
    })
    await pasteArticle(page, GREEN, { components: true })
    await expect(page.getByTestId('source-xiumi')).toHaveClass(/\bon\b/)
    await page.getByTestId('article-import').click()
    await expect(page.locator('.toast')).toContainText(/新增 \d+ 个组件/)
    await expect(page.locator('.toast')).toContainText('2 张图片转存失败')
    expect(new Set(requested)).toEqual(new Set(['https://img.xiumi.us/ok.jpg', 'https://img.xiumi.us/fail.jpg', 'https://statics.xiumi.us/paper.png']))

    const html = await canvas(page).innerHTML()
    expect(html).toContain(`/media/${assets[0].file}`)
    expect(html).not.toContain('ok.jpg')
    expect(html).toContain('fail.jpg') // 失败的保留原地址，便于用户替换

    // 大版块按结构拆开，而不是整块收藏；重复结构只收一次；纯文字不收
    const list = await listComponents(page)
    expect(list.length).toBeGreaterThanOrEqual(3)
    expect(list.map((c) => c.name).join()).toContain('绿色图注甲')
    expect(list.map((c) => c.name).join()).not.toContain('绿色图注乙')
    expect(list.every((c) => c.block.props.html.length < 4000 || c.stats.bgPhotos > 0)).toBe(true)
    expect(list.every((c) => c.origin.kind === 'xiumi' && c.origin.attested && !c.origin.redistributable)).toBe(true)
    expect(list.find((c) => c.stats.bgPhotos === 2)).toBeTruthy()
  })

  test('第二个来源：结构重复不收录；检索和筛选；跨来源混排；撤销；刷新后保留；id 不重复', async ({ page }) => {
    await page.goto('/')
    await pasteArticle(page, PURPLE, { components: true })
    await page.getByTestId('source-wechat').click()
    await page.getByTestId('article-import').click()
    await expect(page.locator('.toast')).toContainText('已导入')
    await waitSaved(page)
    await pasteArticle(page, PURPLE, { components: true })
    await page.getByTestId('article-import').click()
    await expect(page.locator('.toast')).toContainText('结构重复未收录')
    await waitSaved(page)

    await openLibrary(page)
    const cards = page.getByTestId('component-card')
    const total = (await listComponents(page)).length
    await expect(cards).toHaveCount(total)
    await page.getByTestId('component-search').fill('紫色引言')
    await expect(cards).toHaveCount(1)
    await page.getByTestId('component-search').fill('')
    await page.getByTestId('hue-green').click()
    await expect(cards.filter({ hasText: '紫色' })).toHaveCount(0)
    await expect(cards.first()).toBeVisible()
    await page.getByTestId('hue-green').click()
    await page.getByTestId('kind-heading').click()
    await expect(cards.filter({ hasText: '绿色标题' })).toHaveCount(1)
    await expect(cards.filter({ hasText: '绿色图注甲' })).toHaveCount(0)
    await page.getByTestId('kind-heading').click()

    // 改名和标签后可按标签检索
    const quote = cards.filter({ hasText: '紫色引言' })
    await quote.getByTestId('component-edit').click()
    await quote.getByTestId('component-name').fill('紫色引言块')
    await quote.getByTestId('component-tags').fill('团日 引用')
    await quote.getByTestId('component-edit-save').click()
    await page.getByTestId('component-search').fill('团日')
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toContainText('#引用')
    await page.getByTestId('component-search').fill('')

    // 两个来源混排：同一组件插入两次，模块 id 不重复
    await insertByName(page, '绿色标题')
    await insertByName(page, '紫色引言块')
    await insertByName(page, '紫色引言块')
    await expect(canvas(page)).toContainText('绿色标题')
    const ids = await page.locator('[data-block-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-block-id')))
    expect(new Set(ids).size).toBe(ids.length)
    expect((await canvas(page).innerHTML())).not.toMatch(/onclick|<script/)

    // 也可以从组件库拖到画布末尾
    const before = await page.locator('[data-block-id]').count()
    const handle = cards.filter({ hasText: '绿色图注甲' }).getByTestId('component-insert')
    await page.locator('.drop-end').scrollIntoViewIfNeeded()
    await handle.scrollIntoViewIfNeeded()
    const from = (await handle.boundingBox())!
    const to = (await page.locator('.drop-end').boundingBox())!
    await page.mouse.move(from.x + 20, from.y + 20)
    await page.mouse.down()
    await page.mouse.move(from.x + 40, from.y + 40, { steps: 4 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect(page.locator('[data-block-id]')).toHaveCount(before + 1)
    await expect(page.locator('[data-block-id]').last()).toContainText('绿色')
    const count = before + 1

    await page.keyboard.press('Control+z')
    await expect(page.locator('[data-block-id]')).toHaveCount(count - 1)
    await page.keyboard.press('Control+y')
    await expect(page.locator('[data-block-id]')).toHaveCount(count)
    await waitSaved(page)

    await page.reload()
    await expect(page.locator('[data-block-id]')).toHaveCount(count)
    await expect(canvas(page)).toContainText('绿色标题')
    await openLibrary(page)
    await expect(cards).toHaveCount(total)
    await expect(cards.filter({ hasText: '紫色引言块' })).toHaveCount(1)
  })

  test('在大版块里按建议拆分或在画布上点选，收藏其中一部分', async ({ page }) => {
    await page.goto('/')
    await pasteArticle(page, GREEN)
    await page.getByTestId('article-import').click()
    await expect(page.locator('.toast')).toContainText('已导入')
    // 现在导入时卡片会拆开：轮播单独成块，标题和图注各在自己的模块里
    const htmlBlocks = page.locator('[data-block-type=html]')
    const carouselBlock = htmlBlocks.filter({ has: page.locator('svg[viewBox="0 0 1080 720"]') })
    await expect(carouselBlock).toHaveCount(1)
    expect((await carouselBlock.innerText()).replace(/[⠿\s]/g, '')).toBe('') // 只剩拖动手柄
    await expect(htmlBlocks.filter({ hasText: '绿色标题' })).not.toContainText('绿色图注')

    // 以前导入的项目里仍是一整个大版块：在它里面按建议拆分或点选
    const now = Date.now()
    const old = { id: `old-${now}`, title: '以前导入的大版块', author: '', digest: '', themeId: 'minimal-magazine', createdAt: now, updatedAt: now, blocks: [{ id: 'big1', type: 'html', props: { html: GREEN.slice(0, GREEN.indexOf('<section powered-by')), label: '大版块' } }] }
    await page.request.put(`/api/projects/${old.id}`, { data: old })
    await page.reload()
    await expect(page.locator('.title-input')).toHaveValue('以前导入的大版块')
    const big = page.locator('[data-block-type=html]').filter({ hasText: '绿色标题' }).first()
    await big.click({ position: { x: 5, y: 5 } })
    await page.getByTestId('collect-block').click()
    const rows = page.getByTestId('split-list').locator('button')
    expect(await rows.count()).toBeGreaterThan(3)
    await expect(page.getByTestId('split-list')).toContainText('重复 2 次')

    // 未确认使用权不能收藏
    await rows.filter({ hasText: '绿色标题' }).click()
    await expect(page.getByTestId('collect-preview')).toContainText('绿色标题')
    await expect(page.getByTestId('collect-preview')).not.toContainText('绿色图注')
    await expect(page.getByTestId('collect-save')).toBeDisabled()
    await page.getByTestId('collect-attest').check()
    // 已经在第一步收藏过：提示重复，不新增
    const before = (await listComponents(page)).length
    await page.getByTestId('collect-save').click()
    await expect(page.locator('.toast')).toContainText('没有重复收藏')
    expect((await listComponents(page)).length).toBe(before)
    await page.getByTestId('collect-close').click()

    // 点选：点文字选中所在版块，可向外扩大再缩回，取消后恢复
    await page.getByTestId('pick-fragment').click()
    const picker = page.getByTestId('fragment-picker')
    await picker.getByText('绿色小结').click()
    await expect(picker.locator('.fragment-picked')).toContainText('绿色小结')
    await expect(picker.locator('.fragment-picked')).not.toContainText('绿色图注')
    await page.getByTestId('pick-expand').click()
    await expect(picker.locator('.fragment-picked')).toContainText('绿色图注')
    await page.getByTestId('pick-shrink').click()
    await expect(picker.locator('.fragment-picked')).not.toContainText('绿色图注')

    await picker.locator('svg[viewBox="0 0 1080 720"]').first().click({ force: true })
    await expect(picker.locator('.fragment-picked svg').first()).toBeVisible()
    await page.getByTestId('pick-collect').click()
    await expect(page.getByTestId('split-list')).toContainText('画布上选中的部分')
    await page.getByTestId('collect-name').fill('绿色轮播')
    await page.getByTestId('collect-tags').fill('轮播 活动')
    await page.getByTestId('collect-attest').check()
    await page.getByTestId('collect-save').click()
    await expect(page.locator('.toast')).toContainText(/绿色轮播|没有重复收藏/)
    await page.getByTestId('collect-close').click()
    await expect(picker).toHaveCount(0)

    await big.click({ position: { x: 5, y: 5 } })
    await page.getByTestId('pick-fragment').click()
    await page.getByTestId('pick-cancel').click()
    await expect(page.getByTestId('fragment-picker')).toHaveCount(0)
    await expect(canvas(page)).toContainText('绿色标题')

    // 拆开以前导入的大版块：轮播单独成块，标题和图注分开；可撤销
    await expect(htmlBlocks).toHaveCount(1)
    await big.click({ position: { x: 5, y: 5 } })
    await page.getByTestId('split-block').click()
    await expect(page.locator('.toast')).toContainText('已拆成')
    expect(await htmlBlocks.count()).toBeGreaterThan(3)
    await expect(carouselBlock).toHaveCount(1)
    expect((await carouselBlock.innerText()).replace(/[⠿\s]/g, '')).toBe('')
    await expect(htmlBlocks.filter({ hasText: '绿色标题' })).not.toContainText('绿色图注')
    await page.locator('body').click({ position: { x: 2, y: 2 } })
    await page.keyboard.press('Control+z')
    await expect(htmlBlocks).toHaveCount(1)
  })

  test('统一配色：可撤销；换背景图后就地编辑不丢失，导出时一并内嵌', async ({ page }) => {
    await page.goto('/')
    await pasteArticle(page, PURPLE)
    await page.getByTestId('article-import').click()
    await expect(page.locator('.toast')).toContainText('已导入')
    await openLibrary(page)

    await insertByName(page, '绿色标题')
    const inserted = page.locator('[data-block-type=html]').filter({ hasText: '绿色标题' })
    await expect(inserted).toHaveCount(1)
    const original = await inserted.innerHTML()
    expect(original).toContain('#528065')
    await inserted.click({ position: { x: 5, y: 5 } })
    await page.getByTestId('match-colors').click()
    await expect(page.locator('.toast')).toContainText('已匹配本文配色')
    expect(await inserted.innerHTML()).not.toContain('#528065')
    await page.locator('.canvas-scroll').click({ position: { x: 3, y: 3 } })
    await page.keyboard.press('Control+z')
    await expect.poll(() => inserted.innerHTML()).toContain('#528065')
    await page.keyboard.press('Control+y')

    // 开启后插入的组件自动匹配
    await page.getByTestId('match-on-insert').check()
    await insertByName(page, '绿色图注甲')
    const matched = page.locator('[data-block-type=html]').filter({ hasText: '绿色图注甲' })
    await expect(matched).toHaveCount(1)
    expect(await matched.innerHTML()).not.toContain('#528065')
    await page.getByTestId('match-on-insert').uncheck()

    // 换轮播背景图：同一张图的两处一起换
    const withBg = (await listComponents(page)).find((c) => c.stats.bgPhotos === 2)
    const cards = page.getByTestId('component-card')
    await cards.filter({ hasText: withBg.name }).getByTestId('component-insert').click()
    const block = page.locator('[data-block-type=html]').filter({ has: page.locator('svg[viewBox="0 0 1080 720"]') }).last()
    await expect(block).toBeVisible()
    // 微信背景图显示时走本地转发，保存的还是原地址
    expect(await block.innerHTML()).toContain('/api/wx-image?u=')
    await block.click({ position: { x: 5, y: 5 } })
    await page.getByTestId('bg-photo-0').click()
    await page.getByTestId('bg-asset').first().click()
    await expect.poll(async () => (await block.innerHTML()).match(/\/media\/[\w-]+\.jpg\?fit=100%3A67/g)?.length).toBe(2)
    expect(await block.innerHTML()).not.toContain('/p1/')

    await block.dblclick({ position: { x: 5, y: 5 } })
    await expect(page.locator('.html-editor')).toBeVisible()
    await page.getByRole('button', { name: '完成' }).click()
    await expect.poll(async () => (await block.innerHTML()).match(/\/media\/[\w-]+\.jpg/g)?.length).toBe(2)
    await waitSaved(page)
    const saved = await (await page.request.get(`/api/projects/${(await (await page.request.get('/api/projects')).json())[0].id}`)).json()
    const savedHtml = saved.blocks.flatMap((b: any) => (b.type === 'html' ? [b.props.html] : [])).join('')
    expect(savedHtml).not.toContain('wx-image')
    expect(savedHtml).toContain('mmbiz.qpic.cn/sz_mmbiz_jpg/p2/')

    await page.getByTestId('open-export').click()
    await page.getByTestId('copy-wechat').click()
    await expect(page.locator('.toast')).toContainText('已复制')
    const out = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read()
      return (await item.getType('text/html')).text()
    })
    expect(out).toContain('紫色模板封面')
    expect(out).toContain('绿色标题')
    expect(out).not.toContain('/media/')
    expect(out).not.toContain('wx-image')
    expect(out).toMatch(/background-image: url\(&quot;data:image\/jpeg;base64,|background-image:\s*url\("data:image\/jpeg;base64,/)
  })

  test('模板部件当作虚拟组件：插入不改模板，收藏后标记；组件缺图时提示', async ({ page }) => {
    await page.goto('/')
    await pasteArticle(page, PURPLE.replace('紫色模板封面', '模板里的封面').replace('#5b3a9c', '#123456'), { template: true })
    await page.getByTestId('article-import').click()
    await expect(page.locator('.toast')).toContainText('并保存为模板')
    const before = JSON.stringify(await (await page.request.get('/api/templates')).json())

    await openLibrary(page)
    await page.getByTestId('components-parts').click()
    const parts = page.getByTestId('part-card')
    const cover = parts.filter({ hasText: '模板里的封面' }).first()
    await expect(cover).toBeVisible()
    const count = await page.locator('[data-block-id]').count()
    await cover.getByTestId('part-insert').click()
    await expect(page.locator('[data-block-id]')).toHaveCount(count + 1)

    await cover.getByTestId('part-collect').click()
    await page.getByTestId('collect-attest').check()
    await page.getByTestId('collect-save').click()
    await expect(page.locator('.toast')).toContainText('已收藏组件')
    await expect(page.getByTestId('collect-close')).toHaveCount(0) // 没有可拆分的子结构时，收藏后直接关闭
    await expect(cover).toContainText('已收藏')
    expect(JSON.stringify(await (await page.request.get('/api/templates')).json())).toBe(before)

    // 组件用到的素材被删除：列表和插入时都提示
    const asset = (await (await page.request.get('/api/assets')).json()).at(-1)
    const draft = { name: '缺图组件', kind: 'image', tags: [], fingerprint: 'test:missing', palette: [], fixedDecor: 0, stats: { texts: 0, photos: 1, bgPhotos: 0, chars: 10 }, text: '', block: { id: 'x', type: 'html', props: { html: `<section style="border: 1px solid #000"><img src="/media/${asset.file}"></section>`, label: '缺图' } }, origin: { kind: 'other', attested: true, title: '' } }
    await page.request.post('/api/components', { data: draft })
    await page.request.delete(`/api/assets/${asset.id}`)
    await page.reload()
    await openLibrary(page)
    const broken = page.getByTestId('component-card').filter({ hasText: '缺图组件' })
    await expect(broken.getByTestId('component-missing')).toContainText('缺 1 张图片')
    await broken.getByTestId('component-insert').click()
    await expect(page.locator('.toast')).toContainText('已从素材库删除')

    // 删除组件不影响已插入文档的内容
    page.on('dialog', (d) => d.accept())
    await broken.getByTestId('component-delete').click()
    await expect(page.getByTestId('component-card').filter({ hasText: '缺图组件' })).toHaveCount(0)
    await expect(page.locator('[data-block-id]').filter({ has: page.locator(`img[src*="${asset.file}"]`) })).toHaveCount(1)
  })
})
