import { expect, test } from '@playwright/test'
import { createBlock } from '../../src/core/blocks'
import { defaultReplay, makeItem, makeScene } from '../../src/core/replay'

for(const trigger of ['tap','auto'] as const) test(`zero-hold ${trigger} replay has visible static canvas content without changing saved playback`,async({page})=>{
 const id=`replay-static-${Date.now()}-${Math.random().toString(36).slice(2)}`
 const text='静态成稿必须可见'
 const replay=createBlock('replay',{...defaultReplay(),textMode:'svg-text',scenes:[makeScene([makeItem('title',{content:text,enter:'pop'})])]})
 replay.id='static-replay';replay.props.playback.trigger=trigger;replay.props.playback.loop={hold:0}
 const put=await page.request.put(`/api/projects/${id}`,{data:{id,title:'回放成稿验证',themeId:'minimal-magazine',blocks:[replay],createdAt:Date.now(),updatedAt:Date.now()}})
 expect(put.ok()).toBe(true)
 await page.route('**/api/projects',route=>route.fulfill({json:[{id,title:'回放成稿验证'}]}))
 await page.goto('/');await expect(page.locator('.title-input')).toHaveValue('回放成稿验证')
 const canvas=page.locator('[data-block-id="static-replay"] .replay-canvas .block-html')
 await expect.poll(()=>canvas.evaluate((root,label)=>{
  const svg=root.querySelector('svg') as SVGSVGElement|null
  const node=[...root.querySelectorAll('text')].find(node=>node.textContent?.includes(label))
  if(!svg||!node||!svg.animationsPaused()||svg.getCurrentTime()<=0)return false
  for(let el:Element|null=node;el&&el!==root;el=el.parentElement)if(Number(getComputedStyle(el).opacity)<.99)return false
  return node.getBoundingClientRect().width>0 && !root.querySelector('[repeatCount="indefinite"]')
 },text)).toBe(true)
 await page.screenshot({path:`test-results/replay-canvas-final-${trigger}.png`,fullPage:true})
 // Interactive playback retains the loop; only the static canvas copy is once-only.
 await page.getByTestId('replay-open').click()
 await expect(page.getByTestId('replay-stage').locator('[repeatCount="indefinite"]').first()).toBeAttached()
 const saved=await(await page.request.get(`/api/projects/${id}`)).json()
 expect(saved.blocks[0].props.playback.trigger).toBe(trigger);expect(saved.blocks[0].props.playback.loop).toEqual({hold:0})
})
