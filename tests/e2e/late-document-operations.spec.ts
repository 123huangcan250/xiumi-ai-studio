import { expect, test, type Route } from '@playwright/test'

test('cancelled delayed version restoration cannot overwrite later edits; normal restore remains undoable',async({page})=>{
  const id=`late-version-${Date.now()}`
  const now=Date.now()
  const doc={id,title:'current manuscript',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks:[]}
  expect((await page.request.put(`/api/projects/${id}`,{data:doc})).ok()).toBe(true)
  const posted=await page.request.post(`/api/projects/${id}/versions`,{data:{doc:{...doc,title:'historical version'},label:'saved history'}})
  expect(posted.ok(),await posted.text()).toBe(true)
  const version=await posted.json()
  const listed=await page.request.get(`/api/projects/${id}/versions`)
  expect(listed.ok(),await listed.text()).toBe(true)
  expect(await listed.json()).toContainEqual(expect.objectContaining({id:version.id,label:'saved history'}))
  await page.goto('/')
  // An unrelated in-flight request must not gate version restoration assertions.
  // Keep it pending until every save/restore/undo assertion has completed.
  let backgroundRequest: Route | undefined
  await page.route('**/__e2e/late-restore-background', route => { backgroundRequest = route })
  await page.evaluate(() => { void fetch('/__e2e/late-restore-background').catch(() => {}) })
  await expect.poll(() => Boolean(backgroundRequest)).toBe(true)
  const title=page.getByLabel('文章标题',{exact:true})
  await expect(title).toHaveValue('current manuscript')
  await page.getByRole('button',{name:'历史版本',exact:true}).click()
  let release!:()=>void
  const gate=new Promise<void>(resolve=>{release=resolve})
  let requested=false
  await page.route(`**/api/projects/${id}/versions/${version.id}`,async route=>{requested=true;await gate;await route.continue()})
  await page.getByRole('dialog').getByRole('button',{name:'恢复',exact:true}).click()
  await expect.poll(()=>requested).toBe(true)
  await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click()
  await title.fill('new edits after cancelling restore')
  const finished=page.waitForResponse(r=>r.url().endsWith(`/versions/${version.id}`))
  release()
  const restoredResponse=await finished
  expect(restoredResponse.ok()).toBe(true)
  // Wait for this response body, not unrelated page/network activity.
  expect(await restoredResponse.finished()).toBeNull()
  await expect(title).toHaveValue('new edits after cancelling restore')
  await expect(page.getByTestId('save-status')).toHaveText('已保存')
  expect((await(await page.request.get(`/api/projects/${id}`)).json()).title).toBe('new edits after cancelling restore')
  await page.unroute(`**/api/projects/${id}/versions/${version.id}`)
  await page.getByRole('button',{name:'历史版本',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'恢复',exact:true}).click()
  await expect(title).toHaveValue('historical version')
  await page.getByRole('button',{name:/撤销/}).click()
  await expect(title).toHaveValue('new edits after cancelling restore')
  await backgroundRequest!.fulfill({ status: 204 })
})
