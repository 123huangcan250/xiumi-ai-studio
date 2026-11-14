import { expect, test, type Page } from '@playwright/test'

async function setup(page: Page) {
  await page.route('**/api/ai/status', route => route.fulfill({json:{enabled:true,name:'Synthetic',model:'synthetic',provider:'openai',profileId:'synthetic'}}))
  await page.route('**/api/ai/suggest-instruction', route => route.fulfill({json:{suggestion:''}}))
  await page.goto('/')
  await expect(page.getByTestId('canvas')).toBeVisible()
  await page.getByTestId('tab-projects').click()
  await page.getByRole('button',{name:'新建空白项目'}).click()
  await page.getByTestId('tab-blocks').click()
  for(const title of ['Multi A','Multi B','Multi C']) {
    await page.getByTestId('lib-card').click()
    await page.getByTestId('tab-style').click()
    await page.locator('.panel.right').getByRole('textbox',{name:'标题',exact:true}).fill(title)
  }
  const cards=page.getByTestId('canvas').locator('[data-block-type="card"]')
  await expect(cards).toHaveCount(3)
  return cards
}

test('Ctrl/Cmd toggle, ordinary click and multi-delete retain history and persisted content',async({page})=>{
  const cards=await setup(page)
  await cards.nth(0).locator('.block-html').click()
  await cards.nth(1).locator('.block-html').click({modifiers:['Control']})
  await expect(page.getByTestId('multi-selection-properties')).toContainText('已选 2 个模块')
  await expect(page.getByTestId('multi-selection-properties')).toContainText('Multi A')
  await cards.nth(0).locator('.block-html').click({modifiers:['Meta']})
  await expect(page.locator('.panel.right').getByRole('textbox',{name:'标题',exact:true})).toHaveValue('Multi B')
  await cards.nth(0).locator('.block-html').click({modifiers:['Control']})
  await page.keyboard.press('Delete')
  await expect(cards).toHaveCount(1);await expect(cards).toContainText('Multi C')
  await page.getByTitle('撤销 Ctrl+Z',{exact:true}).click();await expect(cards).toHaveCount(3)
  await page.getByTitle('重做 Ctrl+Y',{exact:true}).click();await expect(cards).toHaveCount(1)
  await page.keyboard.press('Control+s');await expect(page.getByTestId('save-status')).toContainText('已保存')
  await page.reload();await expect(cards).toHaveCount(1);await expect(cards).toContainText('Multi C')
})

test('multi AI response uses union scope and inline review accepts individual selected modules',async({page})=>{
  const cards=await setup(page)
  await cards.nth(0).locator('.block-html').click();await cards.nth(1).locator('.block-html').click({modifiers:['Control']})
  const ids=await page.locator('.article .block.selected').evaluateAll(nodes=>nodes.map(n=>(n as HTMLElement).dataset.blockId!))
  await page.route('**/api/ai/edit',async route=>{
    const body=route.request().postDataJSON();expect([...body.selectedIds].sort()).toEqual([...ids].sort());expect(body.context.focus.ids).toEqual(body.selectedIds)
    await route.fulfill({json:{summary:'Selected pair',selectionPolicy:'filter',ignoredOps:0,ops:ids.map((id,index)=>({op:'update',id,props:{title:`Accepted ${index}`}}))}})
  })
  await page.getByTestId('tab-ai').click();await expect(page.getByLabel('修改范围').locator('option:checked')).toContainText('2')
  await page.getByLabel('AI 修改指令').fill('只修改所选模块标题');await page.getByRole('button',{name:'生成修改建议',exact:true}).click()
  await expect(page.locator('.review-accept')).toHaveCount(2)
  await page.locator('.review-accept').first().click();await page.locator('.review-reject').first().click()
  await expect(cards.nth(0)).toContainText('Accepted 0');await expect(cards.nth(1)).toContainText('Multi B');await expect(cards.nth(2)).toContainText('Multi C')
  await page.getByTitle('撤销 Ctrl+Z',{exact:true}).click();await expect(cards.nth(0)).toContainText('Multi A');await expect(page.locator('.review-accept')).toHaveCount(0)
})

test('membership ABA rejects a late edit even when the resulting selected set is the same',async({page})=>{
  const cards=await setup(page)
  await cards.nth(0).locator('.block-html').click();await cards.nth(1).locator('.block-html').click({modifiers:['Control']})
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});let started=false
  await page.route('**/api/ai/edit',async route=>{const body=route.request().postDataJSON();started=true;await gate;await route.fulfill({json:{summary:'stale pair',selectionPolicy:'filter',ignoredOps:0,ops:[{op:'update',id:body.selectedIds[0],props:{title:'Wrong stale'}}]}})})
  await page.getByTestId('tab-ai').click();await page.getByLabel('AI 修改指令').fill('change');await page.getByRole('button',{name:'生成修改建议',exact:true}).click();await expect.poll(()=>started).toBe(true)
  await cards.nth(0).locator('.block-html').click({modifiers:['Control']});await cards.nth(0).locator('.block-html').click({modifiers:['Control']})
  const response=page.waitForResponse('**/api/ai/edit');release();await (await response).finished()
  await expect(page.locator('.review-accept')).toHaveCount(0);await expect(cards.nth(0)).toContainText('Multi A')
})

test('390px touch-style mode exposes real selection, mixed properties and cancellation without Ctrl',async({page},testInfo)=>{
  test.skip(process.env.XIUMI_RESPONSIVE_COMBINATION !== '1', 'Responsive shell is supplied by the separately verified PR8 combination, not this narrow candidate')
  await page.addInitScript(() => localStorage.setItem('xiumi-color-mode','dark'))
  const cards=await setup(page);await page.setViewportSize({width:390,height:844})
  await expect(page.locator('html')).toHaveAttribute('data-color-mode','dark')
  const switcher=page.getByRole('navigation',{name:'工作区切换'})
  await switcher.getByRole('button',{name:'画布',exact:true}).click()
  await page.locator('.selection-bar').getByRole('button',{name:'取消选择'}).click()
  const touchButtons=page.locator('.canvas-wrap > .selection-bar button')
  expect(await touchButtons.count()).toBeGreaterThan(0)
  for(const button of await touchButtons.all()) {
    await expect(button).toBeVisible()
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  await page.getByTestId('multi-select-mode').click()
  await cards.nth(0).getByTestId('toggle-block-selection').click();await cards.nth(1).getByTestId('toggle-block-selection').click()
  await expect(cards.nth(0).getByTestId('toggle-block-selection')).toHaveAttribute('aria-pressed','true')
  await page.screenshot({path:testInfo.outputPath('multi-selection-mobile.png')})
  await switcher.getByRole('button',{name:'属性',exact:true}).click();await expect(page.getByTestId('multi-selection-properties')).toContainText('已选 2 个模块')
  await page.getByTestId('tab-ai').click();await expect(page.getByLabel('修改范围').locator('option:checked')).toContainText('2')
  await switcher.getByRole('button',{name:'画布',exact:true}).click();await page.locator('.selection-bar').getByRole('button',{name:'取消选择'}).click()
  await expect(page.locator('.article .block.selected')).toHaveCount(0)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
})

test('explicit multi-selection controls are keyboard-operable without intercepting text deletion',async({page})=>{
  const cards=await setup(page)
  await page.locator('.selection-bar').getByRole('button',{name:'取消选择'}).click()
  await page.getByTestId('multi-select-mode').focus();await page.keyboard.press('Enter')
  await cards.nth(0).getByTestId('toggle-block-selection').focus();await page.keyboard.press('Space')
  await cards.nth(1).getByTestId('toggle-block-selection').focus();await page.keyboard.press('Enter')
  await expect(page.getByTestId('multi-selection-properties')).toContainText('已选 2 个模块')
  await page.getByTestId('multi-select-mode').click();await cards.nth(0).locator('.block-html').click()
  const title=page.locator('.panel.right').getByRole('textbox',{name:'标题',exact:true})
  await title.focus();await page.keyboard.press('Control+a');await page.keyboard.press('Backspace')
  await expect(cards).toHaveCount(3);await expect(title).toHaveValue('')
})
