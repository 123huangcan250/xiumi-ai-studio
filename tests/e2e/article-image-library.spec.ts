import { expect,test,type Page } from '@playwright/test'
import { createBlock } from '../../src/core/blocks'
async function open(page:Page){
 const id=`library-${Date.now()}-${Math.random().toString(36).slice(2)}`
 const blocks=['a','b'].map(key=>({...createBlock('image',{image:{src:`https://img.xiumi.us/${key}`}}),id:key}))
 const doc={id,title:'正文图片收集验收',themeId:'minimal-magazine',blocks,createdAt:1,updatedAt:1}
 expect((await page.request.put(`/api/projects/${id}`,{data:doc})).ok()).toBe(true)
 await page.route('**/api/projects',r=>r.fulfill({json:[{id,title:doc.title}]}))
 await page.route('**/api/ai/status',r=>r.fulfill({json:{enabled:false,profileId:'',name:'none',model:'none'}}))
 await page.route('https://img.xiumi.us/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="gray"/></svg>'}))
 await page.goto('/');await expect(page.locator('.title-input')).toHaveValue(doc.title)
 await page.locator('[data-block-id="a"] .block-html').click()
 await page.getByTestId('tab-ai').click()
 return {id,before:(await (await page.request.get(`/api/projects/${id}`)).json()).blocks}
}
test('natural-language collection confirms locally and does not modify persisted article or contact AI',async({page})=>{
 const {id,before}=await open(page);let modelCalls=0,imports=0
 await page.route('**/api/ai/edit',r=>{modelCalls++;return r.fulfill({json:{ops:[]}})})
 await page.route('**/api/assets/import-article',r=>{imports++;const {urls}=r.request().postDataJSON();expect(urls).toEqual(['https://img.xiumi.us/a']);return r.fulfill({json:urls.map((url:string)=>({url,status:'imported'}))})})
 await page.getByLabel('AI 修改指令').fill('帮我把原文中的图片加入我们自己的素材库，不要修改正文')
 await page.getByRole('button',{name:'收集图片到素材库',exact:true}).click()
 const dialog=page.getByRole('dialog');await expect(dialog).toContainText('发现 1 张');expect(imports).toBe(0)
 await dialog.getByRole('button',{name:'确认加入素材库',exact:true}).click();await expect(dialog).toContainText('新增 1 张')
 await dialog.locator('.modal-actions').getByRole('button',{name:'关闭',exact:true}).click();expect(modelCalls).toBe(0)
 expect((await(await page.request.get(`/api/projects/${id}`)).json()).blocks).toEqual(before)
 await expect(page.getByLabel('AI 修改指令')).toHaveValue('帮我把原文中的图片加入我们自己的素材库，不要修改正文')
})
test('partial results retry only failed URLs and closing stops later requests',async({page})=>{
 await open(page);await page.locator('[data-block-id="b"] .block-html').click({modifiers:['Control']})
 const calls:string[]=[];let failed=true
 await page.route('**/api/assets/import-article',r=>{const url=r.request().postDataJSON().urls[0];calls.push(url);return r.fulfill({json:[{url,status:url.endsWith('/b')&&failed?'failed':'existing',error:'合成失败'}]})})
 await page.getByTestId('collect-article-images').click();const dialog=page.getByRole('dialog');await expect(dialog).toContainText('发现 2 张')
 await dialog.getByRole('button',{name:'确认加入素材库'}).click();await expect(dialog).toContainText('失败或未确认 1 张');failed=false
 await dialog.getByRole('button',{name:'重试失败图片'}).click();await expect(dialog).toContainText('已存在 2 张');expect(calls).toEqual(['https://img.xiumi.us/a','https://img.xiumi.us/b','https://img.xiumi.us/b'])
 await dialog.locator('.modal-actions').getByRole('button',{name:'关闭',exact:true}).click()
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let started=false
 await page.route('**/api/assets/import-article',async r=>{started=true;await gate;await r.fulfill({json:[{url:r.request().postDataJSON().urls[0],status:'existing'}]})})
 await page.getByTestId('collect-article-images').click();await dialog.getByRole('button',{name:'确认加入素材库'}).click();await expect.poll(()=>started).toBe(true)
 await dialog.getByRole('button',{name:'停止剩余并关闭'}).click();const response=page.waitForResponse('**/api/assets/import-article');release();await(await response).finished();await expect(dialog).toHaveCount(0)
})
