import { expect, test, type Page } from '@playwright/test'
import { createBlock } from '../../src/core/blocks'
const pixel='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="80"%3E%3Crect width="120" height="80" fill="gray"/%3E%3C/svg%3E'
async function seed(page:Page){
 const now=Date.now(),id=`drop-boundary-${now}`
 const blocks=[{...createBlock('html',{html:`<p>Source text</p><img src='${pixel}'>`}),id:'source"[\\:漢'}, {...createBlock('html',{html:`<p>Target text</p><img src='${pixel}'>`}),id:'target'}]
 const result=await page.request.put(`/api/projects/${id}`,{data:{id,title:'Drop boundary',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks}});expect(result.ok()).toBe(true)
 await page.goto('/');await expect(page.getByLabel('文章标题',{exact:true})).toHaveValue('Drop boundary');await expect(page.getByTestId('save-status')).toHaveText('已保存');return id
}
test('synthetic malformed drop payloads never throw or modify the persisted article',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const id=await seed(page)
 const before=await(await page.request.get(`/api/projects/${id}`)).json()
 for(const raw of ['{bad', 'null','[]','{}',JSON.stringify({blockId:'source"[\\:漢',index:-1}),JSON.stringify({blockId:'missing',index:0})]){
  await page.locator('[data-block-id="target"] img[data-photo]').evaluate((target,payload)=>{const transfer=new DataTransfer();transfer.setData('application/x-xiumi-photo',payload);target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))},raw)
 }
 expect(errors).toEqual([]);expect((await(await page.request.get(`/api/projects/${id}`)).json()).blocks).toEqual(before.blocks)
 await expect(page.locator('.toast').filter({hasText:'已交换'})).toHaveCount(0)
})
test('a fragment selected then detached cannot open collection or write a component',async({page})=>{
 await seed(page);let writes=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/components'))writes++})
 const target=page.locator('[data-block-id="target"]');await target.click({position:{x:3,y:3}});await target.getByTestId('pick-fragment').click()
 const picker=page.getByTestId('fragment-picker'),paragraph=picker.locator('p').first();await paragraph.click();await paragraph.evaluate(p=>p.remove())
 await page.getByTestId('pick-collect').click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(picker).toBeVisible();expect(writes).toBe(0)
})
