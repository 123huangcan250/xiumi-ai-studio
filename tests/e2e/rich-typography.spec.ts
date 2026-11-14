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
test('font controls keep upstream color selection and keyboard focus at phone width', async ({ page }) => {
  const { editor } = await setup(page, false, 390)
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
