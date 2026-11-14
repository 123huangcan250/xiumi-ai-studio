import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
const phase=process.env.SHELL_PHASE??'before'
const dir='visual-evidence/editorial-shell'
const title='计算机系统概论：从逻辑门到程序执行的完整学习笔记'
const rich=(text:string)=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]})
const blocks=[{id:'heading',type:'heading',props:{index:'01',title:'计算机如何理解一条指令',subtitle:'Computer Systems / 2026',variant:'number'}},...Array.from({length:18},(_,i)=>({id:'paragraph-'+i,type:'paragraph',props:{content:rich('第'+(i+1)+'节：计算机系统由硬件与软件共同构成。处理器从内存读取指令，解释操作码，然后执行运算并保存结果。理解数据的表示、存储层次和程序运行过程，有助于把抽象算法与真实机器联系起来。Memory 1024 / CPU 64-bit。'),align:'justify'}}))]
test.beforeEach(async({page})=>{ const r=await page.request.put('/api/projects/editorial-shell-fixture',{data:{id:'editorial-shell-fixture',title,author:'示例作者',digest:'仅用于隔离视觉验收',themeId:'minimal-magazine',createdAt:1,updatedAt:Date.now(),blocks}});expect(r.ok()).toBeTruthy() })

test('same fixture visual evidence',async({page})=>{
 mkdirSync(dir,{recursive:true})
 const seed={id:'editorial-shell-fixture',title,author:'示例作者',digest:'仅用于隔离视觉验收',themeId:'minimal-magazine',createdAt:1,updatedAt:Date.now(),blocks}
 const res=await page.request.put('/api/projects/'+seed.id,{data:seed});expect(res.ok()).toBeTruthy()
 await page.addInitScript(()=>{localStorage.setItem('xiumi-color-mode','dark');localStorage.removeItem('xiumi-panel-widths');localStorage.removeItem('xiumi-canvas-zoom')})
 await page.goto('/');await expect(page.locator('.title-input')).toHaveValue(title)
 await expect(page.locator('[data-block-id="paragraph-0"]')).toBeVisible()
 const states=[]
 for(const [width,height] of [[1440,900],[1024,768],[390,844]]){
  await page.setViewportSize({width,height});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:dir+'/'+phase+'-'+width+'x'+height+'.png'})
  states.push(await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,articleBg:getComputedStyle(document.querySelector('.phone')!).backgroundColor,toolbar:document.querySelector('.toolbar')!.getBoundingClientRect().height})))
 }
 await page.setViewportSize({width:1440,height:900})
 const more=page.getByTestId('toolbar-more');if(await more.isVisible())await more.click()
 await page.getByTestId('open-data').click();await expect(page.getByRole('dialog')).toBeVisible()
 await page.screenshot({path:dir+'/'+phase+'-data-dialog.png'})
 if(phase==='after'){
  const contrast=await page.locator('.data-modal code').evaluateAll(nodes=>nodes.map(node=>{
   const s=getComputedStyle(node); const lum=(c:string)=>{const values=(c.match(/[\d.]+/g)??[]).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return values[0]*.2126+values[1]*.7152+values[2]*.0722}
   const a=lum(s.color),b=lum(s.backgroundColor);return {color:s.color,background:s.backgroundColor,size:parseFloat(s.fontSize),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
  }))
  for(const c of contrast){expect(c.size).toBeGreaterThanOrEqual(14);expect(c.ratio).toBeGreaterThanOrEqual(4.5)}
  writeFileSync(dir+'/data-path-contrast.json',JSON.stringify(contrast,null,2))
 }
 await page.getByTestId('legacy-path').fill('C:\\nonexistent-xiumi-shell-proof')
 await page.getByTestId('legacy-preview').click()
 await expect(page.locator('.toast.error')).toContainText('nonexistent-xiumi-shell-proof')
 await page.screenshot({path:dir+'/'+phase+'-real-failure.png'})
 writeFileSync(dir+'/'+phase+'-layout.json',JSON.stringify(states,null,2))
})

test('dark shell contract preserves the upstream workflow',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('xiumi-color-mode','dark'))
 await page.goto('/')
 await expect(page.locator('html')).toHaveAttribute('data-color-mode','dark')
 await expect(page.getByTestId('toolbar-more')).toBeVisible()
 await page.getByTestId('toolbar-more').click()
 await page.getByTestId('open-data').click()
 await expect(page.getByTestId('download-backup')).toBeVisible()
 await page.keyboard.press('Escape')
 await page.setViewportSize({width:390,height:844})
 await expect(page.getByRole('button',{name:'画布',exact:true})).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await expect(page.locator('.canvas-wrap')).toBeVisible()
 await page.getByRole('button',{name:'属性',exact:true}).click()
 await expect(page.locator('.panel.right')).toBeVisible()
 await page.getByRole('button',{name:'画布',exact:true}).click()
 await expect(page.locator('.canvas-wrap')).toBeVisible()
})

test('light mobile exposes real theme and workspace controls',async({page})=>{
 await page.setViewportSize({width:390,height:844})
 await page.addInitScript(()=>localStorage.setItem('xiumi-color-mode','light'))
 await page.goto('/')
 await expect(page.getByTestId('toolbar-more')).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await page.getByTestId('toolbar-more').click()
 await page.getByTestId('color-mode-select').selectOption('dark')
 await expect(page.locator('html')).toHaveAttribute('data-color-mode','dark')
 await page.keyboard.press('Escape')
 await page.locator('.title-input').fill('未保存的选区与主题回归')
 await page.locator('[data-block-id="paragraph-0"]').click()
 const before=await page.locator('.phone').innerHTML()
 await page.locator('.canvas-scroll').evaluate(el=>{el.scrollTop=430})
 const scrollBefore=await page.locator('.canvas-scroll').evaluate(el=>el.scrollTop)
 expect(scrollBefore).toBeGreaterThan(0)
 await page.getByRole('button',{name:'属性',exact:true}).click()
 await page.getByRole('button',{name:'资源',exact:true}).click()
 await page.getByRole('button',{name:'画布',exact:true}).click()
 await expect(page.locator('.title-input')).toHaveValue('未保存的选区与主题回归')
 expect(await page.locator('.phone').innerHTML()).toBe(before)
 expect(await page.locator('.canvas-scroll').evaluate(el=>el.scrollTop)).toBe(scrollBefore)
 await page.getByTestId('toolbar-more').click()
 await page.getByTestId('color-mode-select').selectOption('light')
 await expect(page.locator('.canvas-wrap')).toBeVisible()
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('rendered Chinese glyphs, modal keyboard and theme content isolation',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('xiumi-color-mode','light'))
 await page.goto('/')
 await expect(page.locator('[data-block-id="paragraph-0"]')).toBeVisible()
 const original=await page.locator('.block-html').evaluateAll(nodes=>nodes.map(n=>n.innerHTML))
 const originalStyle=await page.locator('[data-block-id="paragraph-0"] p').first().evaluate(el=>({font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize,color:getComputedStyle(el).color}))
 const dataBefore=await (await page.request.get('/api/projects/editorial-shell-fixture')).text()
 await page.getByTestId('color-mode-select').selectOption('dark')
 await expect(page.locator('html')).toHaveAttribute('data-color-mode','dark')
 expect(await page.locator('.block-html').evaluateAll(nodes=>nodes.map(n=>n.innerHTML))).toEqual(original)
 expect(await page.locator('[data-block-id="paragraph-0"] p').first().evaluate(el=>({font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize,color:getComputedStyle(el).color}))).toEqual(originalStyle)
 expect(await (await page.request.get('/api/projects/editorial-shell-fixture')).text()).toBe(dataBefore)
 await page.getByTestId('toolbar-more').click();await page.getByTestId('open-data').click()
 await page.evaluate(()=>document.fonts.ready)
 const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable')
 const {root}=await cdp.send('DOM.getDocument')
 const rendered=[]
 for(const [selector,family] of [['.modal h3','Noto Serif SC'],['[data-testid="download-backup"]','Noto Sans SC']]){
  const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector})
  const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId})
  expect(fonts.some(f=>f.isCustomFont&&f.familyName.includes(family)&&f.glyphCount>0)).toBeTruthy()
  rendered.push({selector,fonts})
 }
 writeFileSync(dir+'/rendered-fonts.json',JSON.stringify(rendered,null,2))
 const download=page.waitForEvent('download');await page.getByTestId('download-backup').click();expect((await download).suggestedFilename()).toMatch(/zip$/)
 await page.keyboard.press('Escape');await expect(page.getByTestId('toolbar-more')).toBeFocused()
 await page.keyboard.press('Enter');await page.getByTestId('open-ai-settings').click()
 await expect(page.getByRole('dialog')).toBeVisible()
 await page.screenshot({path:dir+'/after-ai-settings.png'})
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await page.screenshot({path:dir+'/after-ai-settings-mobile.png'})
 await page.keyboard.press('Shift+Tab');expect(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement))).toBeTruthy()
 await page.keyboard.press('Escape')
})

test('upstream quit flow remains accessible and saves before isolated quit',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('xiumi-color-mode','dark'))
 await page.route('**/api/app/info',r=>r.fulfill({json:{canQuit:true,dataDir:'isolated-proof'}}))
 let quit=0;await page.route('**/api/app/quit',r=>{quit++;return r.fulfill({json:{ok:true}})})
 await page.goto('/');await page.getByTestId('toolbar-more').click()
 page.on('dialog',dialog=>dialog.accept())
 await page.getByTestId('quit-app').click()
 await expect(page.getByTestId('quit-screen')).toContainText('已退出');expect(quit).toBe(1)
})

test('authored heading paragraph HTML and code retain computed presentation and export',async({page})=>{
 const special={id:'editorial-shell-fixture',title,author:'',digest:'',themeId:'minimal-magazine',createdAt:1,updatedAt:Date.now(),blocks:[...blocks,{id:'authored-code',type:'html',props:{label:'Authored HTML',html:'<section style="background:#faf5e9;color:#302c28;font-family:Georgia,serif;font-size:17px"><p>原文 HTML 与 code 2048</p><code style="font-family:monospace;font-size:16px;color:#124820;background:#e1f2dc">const n = 2048</code></section>'}}]}
 expect((await page.request.put('/api/projects/'+special.id,{data:special})).ok()).toBeTruthy()
 await page.addInitScript(()=>localStorage.setItem('xiumi-color-mode','light'))
 await page.goto('/');await expect(page.locator('[data-block-id="authored-code"]')).toBeVisible()
 const capture=()=>page.locator('.phone .block-html, .phone .block-html *').evaluateAll(nodes=>nodes.map(node=>{const s=getComputedStyle(node);return {html:node.innerHTML,font:s.fontFamily,size:s.fontSize,color:s.color,background:s.backgroundColor}}))
 const before=await capture()
 const compiled=await page.evaluate(async()=>{const path='/src/core/compiler.ts';const {compileDoc}=await import(/* @vite-ignore */ path);return compileDoc(await(await fetch('/api/projects/editorial-shell-fixture')).json()).html})
 await page.getByTestId('color-mode-select').selectOption('dark')
 expect(await capture()).toEqual(before)
 const after=await page.evaluate(async()=>{const path='/src/core/compiler.ts';const {compileDoc}=await import(/* @vite-ignore */ path);return compileDoc(await(await fetch('/api/projects/editorial-shell-fixture')).json()).html})
 expect(after).toBe(compiled)
 writeFileSync(dir+'/article-theme-invariance.json',JSON.stringify({nodes:before.length,computedStylesIdentical:true,compiledHtmlIdentical:true},null,2))
})

test('authored colliding UI class names cannot inherit shell overrides',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('xiumi-color-mode','light'))
 await page.goto('/');await expect(page.locator('[data-block-id="paragraph-0"]')).toBeVisible()
 await page.locator('[data-block-id="paragraph-0"] .block-html').evaluate(node=>{node.innerHTML='<section class="modal"><div class="data-modal"><code>original code</code><p class="hint">original hint</p></div><div class="color-pop"><div class="color-group"><small>original label</small></div></div></section>'})
 const capture=()=>page.locator('[data-block-id="paragraph-0"] .block-html *').evaluateAll(nodes=>nodes.map(node=>{const s=getComputedStyle(node);return {color:s.color,bg:s.backgroundColor,size:s.fontSize,font:s.fontFamily}}))
 const before=await capture();await page.getByTestId('color-mode-select').selectOption('dark');expect(await capture()).toEqual(before)
})
