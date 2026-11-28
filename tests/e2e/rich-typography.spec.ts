import { expect, test, type Page, type Locator } from '@playwright/test'
import { createBlock } from '../../src/core/blocks'
import { compileDoc } from '../../src/core/compiler'

async function setup(page: Page, html: boolean | string = false, width = 1440) {
  await page.setViewportSize({width,height:900})
  const id = `fonts-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const block = html ? createBlock('html', { html: typeof html === 'string' ? html : '<p>alpha <strong>bold</strong></p><p><img src="/media/missing.png">omega</p>', label: 'Font fixture' }) : createBlock('paragraph', { content: { type:'doc', content:[{type:'paragraph',content:[{type:'text',text:'alpha beta gamma'}]}] } })
  block.id = 'font-block'
  const doc = { id, title:'Typography fixture', author:'',digest:'',themeId:'minimal-magazine',createdAt:Date.now(),updatedAt:Date.now(),blocks:[block] }
  expect((await page.request.put('/api/projects/'+id,{data:doc})).ok()).toBe(true)
  await page.route('**/api/projects',r=>r.fulfill({json:[{id,title:doc.title}]}))
  await page.goto('/')
  await expect(page.locator('.title-input')).toHaveValue(doc.title)
  await page.locator('[data-block-id="font-block"]').dblclick()
  const editor = page.locator(html ? '.html-editor' : '.tiptap')
  await expect(editor).toBeVisible()
  return {id,editor}
}
async function selectText(editor: Locator, start: number, end: number) {
  await editor.evaluate((root,{start,end})=>{
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); const nodes:Text[]=[]
    while(walker.nextNode()) nodes.push(walker.currentNode as Text)
    const point=(offset:number):[Text,number]=>{for(const n of nodes){if(offset<=n.length)return[n,offset];offset-=n.length}return[nodes.at(-1)!,nodes.at(-1)!.length]}
    const a=point(start),b=point(end),range=document.createRange();range.setStart(...a);range.setEnd(...b)
    ;(root as HTMLElement).focus();const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'))
  },{start,end})
}
test('rich selected text font and size persist, export and undo without changing adjacent text',async({page})=>{
  const {id,editor}=await setup(page)
  await selectText(editor,6,10)
  await page.getByLabel('正文字体',{exact:true}).selectOption('Noto Serif SC Variable, Noto Serif SC, SimSun, serif')
  await page.getByLabel('正文字号',{exact:true}).selectOption('24px')
  const selected=editor.locator('span').filter({hasText:'beta'})
  await expect(selected).toHaveCSS('font-size','24px')
  await expect(selected).toHaveCSS('font-family','"Noto Serif SC Variable", "Noto Serif SC", SimSun, serif')
  await editor.press('Control+z')
  await expect(editor.locator('span').filter({hasText:'beta'})).not.toHaveCSS('font-size','24px')
  await editor.press('Control+Shift+z')
  await expect(editor.locator('span').filter({hasText:'beta'})).toHaveCSS('font-size','24px')
  await page.locator('.rich-toolbar .done').click()
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  const saved=await (await page.request.get('/api/projects/'+id)).json()
  const rendered=compileDoc(saved).html
  expect(rendered).toContain('font-size:24px;');expect(rendered).toContain('font-family:Noto Serif SC Variable, Noto Serif SC, SimSun, serif;')
  expect(saved.blocks[0].props.content.content[0].content[0].marks).toBeUndefined()
  await page.reload();await expect(page.locator('[data-block-id="font-block"] span').filter({hasText:'beta'})).toHaveCSS('font-size','24px')
})
test('collapsed rich selection changes subsequent typing rather than existing text',async({page})=>{
  const {editor}=await setup(page)
  await editor.press('Control+End')
  await page.getByLabel('正文字号',{exact:true}).selectOption('32px')
  await editor.pressSequentially(' NEW')
  await expect(editor.locator('span').filter({hasText:'NEW'})).toHaveCSS('font-size','32px')
  await expect(editor).toHaveText('alpha beta gamma NEW')
})
test('font controls keep upstream color selection and keyboard focus on the desktop workspace', async ({ page }) => {
  const { editor } = await setup(page, false, 1440)
  await selectText(editor, 6, 10)
  await page.getByTestId('rich-color').click()
  await page.getByTestId('rich-color-pop').getByRole('button', { name: '红色', exact: true }).click()
  const font = page.getByLabel('正文字体', { exact: true })
  await font.focus(); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
  await expect(font).toBeFocused()
  await expect(editor).toHaveText('alpha beta gamma')
  await page.getByLabel('正文字号', { exact: true }).selectOption('24px')
  await expect(editor.locator('span').filter({ hasText: 'beta' })).toHaveCSS('color', 'rgb(192, 57, 43)')
  await font.selectOption(''); await page.getByLabel('正文字号', { exact: true }).selectOption('')
  await expect(editor.locator('span').filter({ hasText: 'beta' })).toHaveCSS('color', 'rgb(192, 57, 43)')
  await page.getByTestId('rich-color').click(); await page.keyboard.press('Escape')
  await expect(page.getByTestId('rich-color-pop')).toBeHidden(); await expect(editor).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const done = page.locator('.rich-toolbar .done'); await done.focus(); await page.keyboard.press('Enter')
  await expect(editor).toBeHidden()
})

test('imported text formatting keeps surrounding content and persists after save', async ({ page }) => {
  const { id, editor } = await setup(page, true)
  const size = page.getByLabel('原文字号', { exact: true })
  await expect(size).toBeDisabled()
  await selectText(editor, 0, 5)
  await size.selectOption('24px')
  await page.getByLabel('原文字体', { exact: true }).selectOption('Arial, sans-serif')
  await page.getByRole('button', { name: '原文加粗', exact: true }).click()
  await page.getByRole('button', { name: '原文斜体', exact: true }).click()
  await page.getByRole('button', { name: '原文下划线', exact: true }).click()
  await page.getByLabel('原文文字颜色', { exact: true }).fill('#123456')
  const styled = editor.getByText('alpha', { exact: true })
  await expect(styled).toHaveCSS('font-size', '24px')
  await expect(styled).toHaveCSS('font-family', 'Arial, sans-serif')
  await expect(styled).toHaveCSS('font-weight', '700')
  await expect(styled).toHaveCSS('font-style', 'italic')
  await expect(editor.locator('u').filter({ hasText: 'alpha' })).toHaveCount(1)
  await expect(styled).toHaveCSS('color', 'rgb(18, 52, 86)')
  await editor.press('Control+z')
  await expect(styled).not.toHaveCSS('color', 'rgb(18, 52, 86)')
  await editor.press('Control+Shift+z')
  await expect(styled).toHaveCSS('color', 'rgb(18, 52, 86)')
  await expect(editor.locator('p')).toHaveCount(2)
  await expect(editor.locator('p').first()).toHaveText('alpha bold')
  await expect(editor.locator('img')).toHaveCount(1)
  await expect(editor.getByText('omega', { exact: true })).not.toHaveCSS('font-size', '24px')
  await page.locator('.rich-toolbar .done').click()
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  const saved = await (await page.request.get('/api/projects/' + id)).json()
  expect(compileDoc(saved).html).toContain('24px')
  await page.reload()
  await expect(page.locator('[data-block-id="font-block"]').getByText('alpha', { exact: true })).toHaveCSS('color', 'rgb(18, 52, 86)')
  await expect(page.locator('[data-block-id="font-block"] p').first()).toHaveText('alpha bold')
})

test('requesting typography across imported table cells leaves the structure intact', async ({ page }) => {
  const { editor } = await setup(page, '<table><tbody><tr><td>one</td><td>two</td></tr></tbody></table>')
  const before = await editor.innerHTML()
  await selectText(editor, 1, 5)
  await page.getByLabel('原文字号', { exact: true }).selectOption('24px')
  await expect(page.getByRole('status').filter({ hasText: '同一个文本区域' })).toBeVisible()
  expect(await editor.innerHTML()).toBe(before)
})

test('imported typography refuses to rewrite links, identifiers, and semantic inline content', async ({ page }) => {
  const { editor } = await setup(page, '<p>left <a href="https://example.org/" id="ref">linked</a> <code>code</code> <del>deleted</del> end</p>')
  const before = await editor.innerHTML()
  for (const [start, end] of [[5, 11], [2, 8], [12, 16], [17, 24]]) {
    await selectText(editor, start, end)
    await page.getByLabel('原文字号', { exact: true }).selectOption('24px')
    await expect(page.getByRole('status').filter({ hasText: '同一个文本区域' })).toBeVisible()
    expect(await editor.innerHTML()).toBe(before)
  }
  await expect(editor.locator('a#ref')).toHaveAttribute('href', 'https://example.org/')
})

test('native undo and redo work while the imported typography toolbar has focus', async ({ page }) => {
  const { editor } = await setup(page, '<p>alpha   beta</p>')
  await selectText(editor, 0, 5)
  const size = page.getByLabel('原文字号', { exact: true })
  const gap = () => editor.evaluate(root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const spaces = / {3}/.exec(node.data)
      if (!spaces) continue
      const range = document.createRange()
      range.setStart(node, spaces.index)
      range.setEnd(node, spaces.index + spaces[0].length)
      return range.getBoundingClientRect().width
    }
    return -1
  })
  const before = await gap()
  expect(before).toBeGreaterThan(0)
  await size.selectOption('24px')
  await expect(size).toBeFocused()
  await expect(editor.getByText('alpha', { exact: true })).toHaveCSS('font-size', '24px')
  expect(await editor.textContent()).toBe('alpha   beta')
  expect(await gap()).toBeCloseTo(before, 1)
  await page.keyboard.press('Control+z')
  await expect(editor.locator('span[style*="24px"]')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(editor.getByText('alpha', { exact: true })).toHaveCSS('font-size', '24px')
})

test('font changes do not expand into styled neighbor text or reveal edge spaces', async ({ page }) => {
  const { editor } = await setup(page, '<p><span style="color:red;background-color:yellow">x chosen y</span></p><p> edge</p>')
  const before = await editor.innerHTML()
  const size = page.getByLabel('原文字号', { exact: true })
  for (const [start, end] of [[2, 8], [11, 15]]) {
    await selectText(editor, start, end)
    await size.selectOption('24px')
    await expect(page.getByRole('status').filter({ hasText: '避免改变原文空白布局' })).toBeVisible()
    expect(await editor.innerHTML()).toBe(before)
  }
})


test('font changes leave line-edge spaces around imported line breaks collapsed', async ({ page }) => {
  const { editor } = await setup(page, '<p>first<br> edge</p><p>last <br>next</p>')
  const before = await editor.innerHTML()
  const size = page.getByLabel('原文字号', { exact: true })
  for (const [start, end] of [[6, 10], [11, 14]]) {
    await selectText(editor, start, end)
    await size.selectOption('24px')
    await expect(page.getByRole('status').filter({ hasText: '避免改变原文空白布局' })).toBeVisible()
    expect(await editor.innerHTML()).toBe(before)
  }
})
