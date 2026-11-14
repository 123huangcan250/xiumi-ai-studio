import { expect, test, type Page } from '@playwright/test'
async function seed(page:Page){
 const now=Date.now(),id=`version-boundary-${now}`
 const result=await page.request.put(`/api/projects/${id}`,{data:{id,title:'Version winner',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks:[]}})
 expect(result.ok()).toBe(true);await page.goto('/');await expect(page.getByLabel('文章标题',{exact:true})).toHaveValue('Version winner');await expect(page.getByTestId('save-status')).toHaveText('已保存');return id
}
test('history duplicate admission stays single while pending, failure is visible and retry persists once',async({page})=>{
 const id=await seed(page);let calls=0,release!:()=>void;const held=new Promise<void>(r=>release=r)
 await page.route(`**/api/projects/${id}/versions`,async route=>{
  if(route.request().method()!=='POST')return route.continue()
  calls++;if(calls===1){await held;return route.fulfill({status:507,json:{error:'synthetic version storage failure'}})}
  return route.continue()
 })
 page.on('dialog',d=>d.accept('Verified manual version'))
 await page.getByRole('button',{name:'历史版本',exact:true}).click()
 const dialog=page.getByRole('dialog'),save=dialog.getByRole('button',{name:'保存当前为新版本',exact:true})
 await save.evaluate((b:HTMLButtonElement)=>{b.click();b.click()})
 await expect.poll(()=>calls).toBe(1);await expect(save).toBeDisabled();release()
 await expect(page.locator('.toast')).toContainText('synthetic version storage failure');await expect(save).toBeEnabled()
 await save.click();await expect(dialog).toContainText('Verified manual version');expect(calls).toBe(2)
 const versions=await(await page.request.get(`/api/projects/${id}/versions`)).json();expect(versions.filter((v:{label:string})=>v.label==='Verified manual version')).toHaveLength(1)
})
test('closed history ignores a late restore and leaves the persisted winner intact',async({page})=>{
 const id=await seed(page),doc=await(await page.request.get(`/api/projects/${id}`)).json()
 const version=await page.request.post(`/api/projects/${id}/versions`,{data:{doc:{...doc,title:'Historical loser'},label:'Old version'}});expect(version.ok()).toBe(true)
 let requested=false,release!:()=>void;const held=new Promise<void>(r=>release=r)
 await page.route(`**/api/projects/${id}/versions/*`,async route=>{requested=true;await held;return route.fulfill({json:{doc:{...doc,title:'Historical loser'}}})})
 await page.getByRole('button',{name:'历史版本',exact:true}).click();const dialog=page.getByRole('dialog')
 await dialog.getByRole('button',{name:'恢复',exact:true}).click();await expect.poll(()=>requested).toBe(true)
 await dialog.getByRole('button',{name:'关闭',exact:true}).click()
 const response=page.waitForResponse(r=>r.url().includes(`/api/projects/${id}/versions/`));release();await response
 await expect(page.getByLabel('文章标题',{exact:true})).toHaveValue('Version winner');await expect(page.getByRole('dialog')).toHaveCount(0)
 expect((await(await page.request.get(`/api/projects/${id}`)).json()).title).toBe('Version winner')
 await page.reload();await expect(page.getByLabel('文章标题',{exact:true})).toHaveValue('Version winner')
})
