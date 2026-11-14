import { expect, test } from '@playwright/test'
test('all-variant save can resume after partial persistence without a blind overwrite',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('save-status')).toHaveText('已保存')
 await page.getByTestId('open-import').click();await page.getByTestId('load-sample').click();await page.getByTestId('generate').click();await expect(page.locator('.variant')).toHaveCount(3)
 let created=0,failed=false
 await page.route('**/api/projects/*',async route=>{
  if(route.request().method()!=='PUT')return route.continue()
  const body=route.request().postDataJSON()
  if(body.revision)return route.continue()
  created++
  if(created===2&&!failed){failed=true;return route.fulfill({status:507,json:{error:'simulated full disk'}})}
  return route.continue()
 })
 const all=page.getByRole('button',{name:'全部保存为项目，并打开第一套'})
 await all.click();await expect.poll(()=>failed).toBe(true)
 await all.click();await expect(page.getByRole('dialog')).toHaveCount(0)
 await expect(page.getByTestId('save-status')).toHaveText('已保存')
})
test('closed long article import never loads its late result into newer edits',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('save-status')).toHaveText('已保存')
 await page.getByTestId('open-article-import').click();await page.getByRole('button',{name:'粘贴富文本'}).click()
 await page.getByTestId('article-paste').evaluate(el=>{const dt=new DataTransfer();dt.setData('text/html','<section><h1>late article</h1><p>article body</p><img src="https://img.xiumi.us/xmi/ua/test.jpg" /></section>');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})
 await page.getByTestId('article-authorized').check()
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r});let requested=false
 await page.route('**/api/assets/fetch',async route=>{requested=true;await gate;await route.fulfill({json:{}})})
 await page.getByTestId('article-import').click();await expect.poll(()=>requested).toBe(true)
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click()
 await page.getByLabel('文章标题',{exact:true}).fill('new work after cancellation')
 const response=page.waitForResponse(r=>r.url().endsWith('/api/assets/fetch'));release();expect(await(await response).finished()).toBeNull()
 await expect(page.locator('.toast')).toContainText('当前文稿未替换')
 await expect(page.getByLabel('文章标题',{exact:true})).toHaveValue('new work after cancellation')
 await expect(page.getByTestId('save-status')).toHaveText('已保存')
})
test('a template persisted after import cancellation announces the resource without replacing the draft',async({page})=>{
 await page.goto('/');await expect(page.getByTestId('save-status')).toHaveText('已保存')
 await page.evaluate(()=>{(window as any).templateEvents=0;window.addEventListener('templates-changed',()=>{(window as any).templateEvents++})})
 await page.getByTestId('open-article-import').click();await page.getByRole('button',{name:'粘贴富文本'}).click()
 await page.getByTestId('article-paste').evaluate(el=>{const dt=new DataTransfer();dt.setData('text/html','<section><h1>retained template</h1><p>template text</p></section>');el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))})
 await page.getByTestId('article-authorized').check()
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r});let requested=false
 await page.route('**/api/templates',async route=>{if(route.request().method()!=='POST')return route.continue();requested=true;await gate;await route.continue()})
 await page.getByTestId('article-import').click();await expect.poll(()=>requested).toBe(true)
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click()
 await page.getByLabel('文章标题',{exact:true}).fill('keep current draft')
 release();await expect.poll(()=>page.evaluate(()=>(window as any).templateEvents)).toBe(1)
 await expect(page.getByLabel('文章标题',{exact:true})).toHaveValue('keep current draft')
})

test('choosing a variant keeps the old draft until persistence succeeds and leaves failures retryable', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await expect(page.getByTestId('canvas')).toBeVisible()
  const manuscript = () => page.locator('[data-testid=canvas] .block[data-block-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.getAttribute('data-block-id'), html: node.querySelector('.block-html')?.innerHTML })))
  const original = await manuscript()
  const originalTitle = await page.getByLabel('文章标题', { exact: true }).inputValue()
  await page.getByTestId('open-import').click()
  await page.getByTestId('load-sample').click()
  await page.getByTestId('generate').click()
  await expect(page.locator('.variant')).toHaveCount(3)
  let requested = false
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let fail = true
  await page.route('**/api/projects/*', async route => {
    if (route.request().method() !== 'PUT' || route.request().postDataJSON().revision) return route.continue()
    requested = true
    await pending
    if (fail) { fail = false; return route.fulfill({ status: 507, json: { error: 'controlled save failure' } }) }
    return route.continue()
  })
  const choose = page.getByTestId('choose-cards')
  await choose.click()
  await expect.poll(() => requested).toBe(true)
  await expect(choose).toBeDisabled()
  // The old manuscript is truthfully saved while the new project's PUT is held.
  // This predicate alone must not be used as variant-selection completion.
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  await expect(page.getByRole('dialog')).toHaveCount(1)
  expect(await manuscript()).toEqual(original)
  await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue(originalTitle)
  release()
  await expect(page.locator('.toast')).toContainText('controlled save failure')
  await expect(choose).toBeEnabled()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  expect(await manuscript()).toEqual(original)
  await expect(page.getByLabel('文章标题', { exact: true })).toHaveValue(originalTitle)
  await choose.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  expect(await manuscript()).not.toEqual(original)
})
