import { expect, test } from '@playwright/test'

const EXTRA = '支队在西门子工厂的装配线前停了很久，工程师把每一道工序的节拍和检测方法都讲了一遍，同学们一边听一边记。'

// 不调用真实模型：AI 接口全部用 page.route 模拟
test('AI 一键排版：有照片描述时先问是否按照片补充文案；是 → 改写、可撤销、继续排版；否 → 直接排版', async ({ page }) => {
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { enabled: true, provider: 'openai', model: 'mock', name: '模拟模型', profileId: 'p' } }))
  await page.route('**/api/ai/outline', (r) => r.fulfill({ status: 500, json: { error: '模拟：不生成大纲' } }))
  await page.route('**/api/ai/design', (r) => r.fulfill({ status: 500, json: { error: '模拟：不生成设计' } }))
  let sent: any = null
  await page.route('**/api/ai/enrich-copy', async (r) => {
    sent = r.request().postDataJSON()
    // 模拟模型：在结尾补一段，并且（违规地）改掉了一句指定位置的句子
    const markdown = `${sent.text}\n\n${EXTRA}`.replace(sent.keep[0] ?? '\u0000', '（被改掉的句子）')
    await r.fulfill({ json: { markdown, changes: ['在结尾补充了装配线的场面'] } })
  })
  const layouts = page.getByRole('heading', { name: '内置版式' })
  const back = () => page.getByText('← 返回修改').click()

  await page.goto('/')
  await page.getByTestId('open-import').click()
  await page.getByTestId('load-sample').click()
  await expect(page.getByTestId('photo-note-2')).toBeVisible()
  const original = await page.getByTestId('import-text').inputValue()

  // 没有照片描述：不询问，直接排版
  await page.getByTestId('generate').click()
  await expect(layouts).toBeVisible()
  await expect(page.getByTestId('enrich-ask')).toHaveCount(0)
  await back()

  // 写了描述：询问；选“否”直接排版，文案不变；同样的描述不再问
  await page.getByTestId('photo-note-2').fill('西门子工厂的装配线')
  await page.getByTestId('generate').click()
  await expect(page.getByTestId('enrich-ask')).toContainText('1 张照片写了描述')
  await page.getByTestId('enrich-no').click()
  await expect(layouts).toBeVisible()
  expect(sent).toBeNull()
  await back()
  await expect(page.getByTestId('import-text')).toHaveValue(original)
  await page.getByTestId('generate').click()
  await expect(layouts).toBeVisible()
  await back()

  // 描述变了：再问；选“是”→ 改写结果先给用户看，指定位置的句子被改会提示，可撤销
  const first = original.split('\n').slice(1).find((l) => l.trim().length > 40 && !l.startsWith('#'))!.trim().slice(0, 12)
  await page.getByTestId('photo-anchor-2').fill(first)
  await page.getByTestId('photo-note-3').fill('实验室合影')
  await page.getByTestId('generate').click()
  await page.getByTestId('enrich-yes').click()
  const result = page.getByTestId('enrich-result')
  await expect(result).toContainText('在结尾补充了装配线的场面')
  await expect(result).toContainText('指定照片位置的句子被改了')
  await expect(result).not.toContainText('标题有改动')
  expect(sent.photos).toEqual([{ no: 2, note: '西门子工厂的装配线', after: first }, { no: 3, note: '实验室合影' }])
  expect(sent.keep).toEqual([first])
  await expect(page.getByTestId('import-text')).toHaveValue(/装配线前停了很久/)
  await page.getByTestId('enrich-undo').click()
  await expect(page.getByTestId('import-text')).toHaveValue(original)
  await expect(result).toHaveCount(0)

  // 描述再变：再问；改写后“继续排版”用修改后的文案
  await page.getByTestId('photo-note-3').fill('实验室全体合影')
  await page.getByTestId('generate').click()
  await page.getByTestId('enrich-yes').click()
  await page.getByTestId('enrich-continue').click()
  await expect(layouts).toBeVisible()
  await back()
  await expect(page.getByTestId('import-text')).toHaveValue(/装配线前停了很久/)
  // 这组描述已经问过：再排版不再询问
  await page.getByTestId('generate').click()
  await expect(layouts).toBeVisible()
  await expect(page.getByTestId('enrich-ask')).toHaveCount(0)
})
