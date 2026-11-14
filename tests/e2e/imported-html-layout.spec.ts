import { expect,test,type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createBlock,normalizeBlocks } from '../../src/core/blocks'
const html='<div><h2 style="color:#ee2222">原文标题</h2><p>原文正文 <a href="https://example.test/reference">保留链接</a></p><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5OIAAAAASUVORK5CYII=" alt="保留图片"><h2>第二章</h2><p>结束文字</p></div>'
async function open(page:Page){
 const id=`html-layout-${Date.now()}-${Math.random().toString(36).slice(2)}`,title='原文清华紫结构验收'
 const blocks=[{...createBlock('html',{html,label:'原文'}),id:'source'}];expect(JSON.stringify(normalizeBlocks(blocks))).toBe(JSON.stringify(blocks))
 expect((await page.request.put(`/api/projects/${id}`,{data:{id,title,themeId:'minimal-magazine',blocks,createdAt:1,updatedAt:1}})).ok()).toBe(true)
 await page.route('**/api/projects',r=>r.fulfill({json:[{id,title}]}));await page.route('**/api/ai/status',r=>r.fulfill({json:{enabled:true,name:'Synthetic',model:'synthetic'}}))
 await page.route('**/api/ai/edit',r=>r.fulfill({json:{summary:'受控分章重排',ops:[{op:'update',id:'source',themeId:'tsinghua-purple',layout:'chapters'}]}}))
 await page.route('https://img.xiumi.us/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#666"/></svg>'}))
 await page.goto('/');await expect(page.locator('.title-input')).toHaveValue(title);await expect(page.locator('.toast').filter({hasText:'已自动修复'})).toHaveCount(0)
 return id
}
async function generate(page:Page){
 await page.getByTestId('tab-ai').click();await page.getByLabel('AI 修改指令').fill('全文按清华紫重新分章排版，保留全部内容')
 await page.getByRole('button',{name:'生成修改建议',exact:true}).click();await expect(page.getByTestId('proposal')).toContainText('受控分章重排')
}
test('imported HTML theme/layout previews actual chapters then accepts, saves, reloads and exports',async({page})=>{
 const id=await open(page);await generate(page)
 const suggestion=page.locator('.review-suggestion'),original=page.locator('[data-block-id="source"] .block-html')
 await expect(original.locator('[data-article-layout]')).toHaveCount(0)
 await expect(suggestion.frameLocator('iframe').locator('[data-article-layout="chapters"]')).toHaveCount(1)
 await expect(suggestion.frameLocator('iframe').locator('[data-layout-chapter]')).toHaveCount(2)
 await suggestion.getByRole('button',{name:'接受',exact:true}).click();await expect(original.locator('[data-article-layout="chapters"]')).toHaveCount(1)
 await expect(page.getByTestId('save-status')).toHaveText('已保存')
 const saved=await(await page.request.get(`/api/projects/${id}`)).json();expect(saved.blocks[0].props.html).toContain('data-article-layout');expect(saved.blocks[0].props.html).toContain('data:image/png;base64,')
 await page.reload();await expect(page.locator('.title-input')).toHaveValue('原文清华紫结构验收');await expect(original.locator('[data-article-layout="chapters"]')).toHaveCount(1)
 await page.getByTestId('open-export').click()
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'微信 HTML（图片内嵌）',exact:true}).click()])
 const output=await readFile((await download.path())!,'utf8');expect(output).toContain('border-left');expect(output).toContain('原文正文');expect(output).toContain('https://example.test/reference');expect(output).toContain('data:image/png;base64,');expect(output).not.toContain('review-suggestion')
})
test('reject preserves source, acceptance then undo restores exact source without reviving proposal',async({page})=>{
 const id=await open(page);await generate(page);await page.locator('.review-suggestion').getByRole('button',{name:'拒绝',exact:true}).click()
 expect((await(await page.request.get(`/api/projects/${id}`)).json()).blocks[0].props.html).toBe(html)
 await generate(page);await page.locator('.review-suggestion').getByRole('button',{name:'接受',exact:true}).click();await expect(page.locator('[data-block-id="source"] [data-article-layout]')).toHaveCount(1)
 await page.locator('.phone-head').click();await page.keyboard.press('Control+z');await expect(page.locator('[data-block-id="source"] [data-article-layout]')).toHaveCount(0);await expect(page.locator('.review-suggestion')).toHaveCount(0)
 await expect(page.getByTestId('save-status')).toHaveText('已保存');expect((await(await page.request.get(`/api/projects/${id}`)).json()).blocks[0].props.html).toBe(html)
})
