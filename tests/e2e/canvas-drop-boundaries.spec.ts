import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { createBlock } from '../../src/core/blocks'
async function seed(page:Page){
 const now=Date.now(),id=`drop-boundary-${now}`
 // Inline data images are decorative in HTML blocks; seed a real uploaded photo.
 const uploaded=await page.request.post('/api/assets',{multipart:{files:{
  name:'drop-boundary.jpg',mimeType:'image/jpeg',buffer:readFileSync('samples/photo-01.jpg'),
 }}})
 expect(uploaded.ok()).toBe(true)
 const [{file}]=await uploaded.json() as Array<{file:string}>
 const photo=`/media/${file}`
 const blocks=[{...createBlock('html',{html:`<p>Source text</p><img src='${photo}'>`}),id:'source"[\\:漢'}, {...createBlock('html',{html:`<p>Target text</p><img src='${photo}'>`}),id:'target'}]
 const result=await page.request.put(`/api/projects/${id}`,{data:{id,title:'Drop boundary',author:'',digest:'',themeId:'minimal-magazine',createdAt:now,updatedAt:now,blocks}});expect(result.ok()).toBe(true)
 await page.goto('/');await expect(page.getByLabel('文章标题',{exact:true})).toHaveValue('Drop boundary');await expect(page.getByTestId('save-status')).toHaveText('已保存');return id
}
test('synthetic malformed drop payloads never throw or modify the persisted article',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const id=await seed(page)
 const before=await(await page.request.get(`/api/projects/${id}`)).json()
 const target=page.locator('[data-block-id="target"] img')
 await expect(target).toHaveAttribute('data-photo','0')
 for(const raw of ['{bad', 'null','[]','{}',JSON.stringify({blockId:'source"[\\:漢',index:-1}),JSON.stringify({blockId:'missing',index:0})]){
  await target.evaluate((target,payload)=>{const transfer=new DataTransfer();transfer.setData('application/x-xiumi-photo',payload);target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}))},raw)
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
