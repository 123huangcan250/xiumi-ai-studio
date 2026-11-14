// @vitest-environment jsdom
import {act,createElement} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {ImageResize} from '../../src/editor/ImageResize'
import {useStore,emptyDoc} from '../../src/editor/store'
import {createBlock} from '../../src/core/blocks'
let host:HTMLDivElement,article:HTMLDivElement,root:Root,img:HTMLImageElement
let rect:DOMRect,parentWidth:number;let frameId=0;const frames=new Map<number,FrameRequestCallback>()
const initial=useStore.getState();let block:ReturnType<typeof createBlock<'html'>>
async function tick(){const pending=[...frames.values()];frames.clear();await act(async()=>pending.forEach(fn=>fn(0)))}
async function pointer(type:string,x=0,id=1,button=0){const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,button});Object.defineProperty(event,'pointerId',{value:id});const handle=host.querySelector('button')!;await act(async()=>handle.dispatchEvent(event))}
async function pick(){await act(async()=>img.click());await tick()}
async function key(key:string,shiftKey=false){await act(async()=>host.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true})))}
beforeEach(async()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;frames.clear();frameId=0;vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{frames.set(++frameId,fn);return frameId});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));HTMLElement.prototype.setPointerCapture=vi.fn()
 block=createBlock('html',{html:'<img src="/media/p.png"><p>preserved</p>'});useStore.setState({...initial,doc:{...emptyDoc(),blocks:[block]},selectedId:block.id},true)
 rect={left:20,top:20,width:200,height:100,bottom:120,right:220} as DOMRect;parentWidth=400
 article=document.createElement('div');article.innerHTML=`<div class="canvas-scroll"><div class="article"><div data-block-id="${block.id}"><div class="block-html"><img data-photo="0" src="/media/p.png"></div></div></div></div>`;document.body.append(article);img=article.querySelector('img')!
 vi.spyOn(img,'getBoundingClientRect').mockImplementation(()=>rect);vi.spyOn(img.parentElement!,'getBoundingClientRect').mockImplementation(()=>({width:parentWidth} as DOMRect));vi.spyOn(article.querySelector('.canvas-scroll')!,'getBoundingClientRect').mockReturnValue({top:0,bottom:500,left:0,right:500} as DOMRect)
 host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(ImageResize)))
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();article.remove();vi.unstubAllGlobals()})
it('measures selected visible images and preserves original until one final drag commit',async()=>{
 const original=useStore.getState().doc;await pick();expect(host.textContent).toContain('50%');await tick();await pointer('pointerdown',20);await pointer('pointermove',120);expect(img.style.width).toBe('75%');expect(useStore.getState().doc).toBe(original);await pointer('pointerup',120);expect(img.getAttribute('style')).toBeNull();expect((useStore.getState().doc.blocks[0].props as any).html).toContain('75%');expect(useStore.getState().past).toHaveLength(1)
})
it('cancellation restores exact prior inline style without history changes',async()=>{
 img.setAttribute('style','width:50%;color:red');const doc=useStore.getState().doc;await pick();await pointer('pointerdown',0);await pointer('pointermove',60);await pointer('pointercancel');expect(img.getAttribute('style')).toBe('width:50%;color:red');expect(useStore.getState().doc).toBe(doc)
 await pointer('pointerdown',0);await pointer('pointermove',60);await pointer('lostpointercapture');expect(img.getAttribute('style')).toBe('width:50%;color:red');await key('Escape');expect(host.querySelector('button')).toBeNull()
})
it('ignores foreign pointers, right click and zero-sized parent; no-op drag adds no history',async()=>{
 await pick();await pointer('pointermove',30);await pointer('pointerup');await pointer('pointerdown',0,1,2);await pointer('pointermove',40);expect(img.style.width).toBe('')
 parentWidth=0;await pointer('pointerdown',0);parentWidth=400;await pointer('pointerdown',0);await pointer('pointermove',90,2);await pointer('pointerup',90,2);expect(img.style.width).toBe('');await pointer('pointerup',0);expect(useStore.getState().past).toHaveLength(0)
})
it('keyboard bounds, shift acceleration and direction keys commit only image width',async()=>{
 await pick();await key('ArrowRight');expect((useStore.getState().doc.blocks[0].props as any).html).toContain('51%');await tick();await key('ArrowUp',true);expect((useStore.getState().doc.blocks[0].props as any).html).toContain('60%');await tick();await key('ArrowLeft');expect((useStore.getState().doc.blocks[0].props as any).html).toContain('49%');await tick();await key('ArrowDown',true);expect((useStore.getState().doc.blocks[0].props as any).html).toContain('40%');await tick();await key('Home');expect((useStore.getState().doc.blocks[0].props as any).html).toContain('10%');await tick();await key('End');expect((useStore.getState().doc.blocks[0].props as any).html).toContain('100%');const doc=useStore.getState().doc;await key('x');expect(useStore.getState().doc).toBe(doc)
})
it('selection/editing/offscreen states hide controls and cancel temporary drag styling',async()=>{
 await pick();await pointer('pointerdown');await pointer('pointermove',50);await act(async()=>useStore.setState({editingId:block.id}));await tick();expect(host.querySelector('button')).toBeNull();expect(img.style.width).toBe('');await act(async()=>useStore.setState({editingId:null}));await tick();rect={...rect,top:600,bottom:700} as DOMRect;await tick();expect(host.querySelector('button')).toBeNull();rect={...rect,top:20,bottom:120} as DOMRect;await tick();await act(async()=>host.querySelector('.image-resize-overlay')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));expect(host.querySelector('button')).toBeTruthy();await act(async()=>document.body.click());expect(host.querySelector('button')).toBeNull()
})
it('a simultaneous block edit invalidates drag commit and leaves newer draft intact',async()=>{
 await pick();await pointer('pointerdown');await pointer('pointermove',50);const newer={...useStore.getState().doc,blocks:[{...block,props:{...block.props,html:'<img src="/media/p.png"><p>NEW</p>'}}]};await act(async()=>{useStore.setState({doc:newer});const event=new MouseEvent('pointerup',{bubbles:true});Object.defineProperty(event,'pointerId',{value:1});host.querySelector('button')!.dispatchEvent(event)});expect(useStore.getState().doc).toBe(newer);expect(useStore.getState().toast?.text).toContain('已变化')
})
it('removed DOM target or changed document cannot be resized by stale events',async()=>{
 await pick();img.remove();await pointer('pointerdown');await tick();expect(host.querySelector('button')).toBeNull()
})
it('one completed gesture creates one undo entry and a changed document id cancels stale events',async()=>{
 await pick();const before=useStore.getState().doc;await pointer('pointerdown',0);await pointer('pointermove',80);await pointer('pointerup',80);await pointer('pointerup',80)
 expect(useStore.getState().past).toHaveLength(1);await act(async()=>useStore.getState().undo());expect(useStore.getState().doc).toBe(before)
 await tick();await pick();await pointer('pointerdown');await pointer('pointermove',40)
 const newer={...useStore.getState().doc,id:'other-doc'};await act(async()=>{useStore.setState({doc:newer});const event=new MouseEvent('pointerup',{bubbles:true});Object.defineProperty(event,'pointerId',{value:1});host.querySelector('button')!.dispatchEvent(event)})
 expect(useStore.getState().doc).toBe(newer);expect(useStore.getState().toast?.text).toContain('已变化')
})
it.each([.5,1.5])('uses viewport geometry correctly at zoom %s',async zoom=>{
 rect={left:20,top:20,width:200*zoom,height:100*zoom,bottom:20+100*zoom,right:20+200*zoom} as DOMRect;parentWidth=400*zoom
 await pick();await pointer('pointerdown',20);await pointer('pointermove',20+100*zoom);expect(img.style.width).toBe('75%');await pointer('pointerup',20+100*zoom)
 expect((useStore.getState().doc.blocks[0].props as {html:string}).html).toContain('75%')
})

it.each(['remove','replace','source'])('rejects keyboard events on a stale DOM target: %s',async mode=>{
 await pick();const before=useStore.getState().doc
 if(mode==='remove') img.remove()
 if(mode==='replace') img.replaceWith(img.cloneNode(true))
 if(mode==='source') img.src='/media/other.png'
 await key('End');expect(useStore.getState().doc).toBe(before);expect(useStore.getState().past).toHaveLength(0)
})
it.each([[-50,20,200,100],[450,20,200,100],[20,-50,200,100],[20,450,200,100]])('clips the overlay to all canvas edges %j',async(left,top,width,height)=>{
 rect={left,top,width,height,right:left+width,bottom:top+height} as DOMRect;await pick()
 const overlay=host.querySelector<HTMLElement>('.image-resize-overlay')!
 expect(parseFloat(overlay.style.left)).toBe(Math.max(0,left));expect(parseFloat(overlay.style.top)).toBe(Math.max(0,top))
 const handle=host.querySelector('button')!;expect(parseFloat(handle.style.left)).toBeGreaterThanOrEqual(0);expect(parseFloat(handle.style.left)+44).toBeLessThanOrEqual(500);expect(parseFloat(handle.style.top)).toBeGreaterThanOrEqual(0);expect(parseFloat(handle.style.top)+44).toBeLessThanOrEqual(500)
 expect(parseFloat(overlay.style.width)).toBe(Math.min(500,left+width)-Math.max(0,left));expect(parseFloat(overlay.style.height)).toBe(Math.min(500,top+height)-Math.max(0,top))
})
it.each([[-300,20],[600,20],[20,-200],[20,600]])('hides fully clipped image %j',async(left,top)=>{
 rect={left,top,width:200,height:100,right:left+200,bottom:top+100} as DOMRect;await pick();expect(host.querySelector('button')).toBeNull()
})
it('keeps a 44px handle for a real 40x20 image after Home and allows keyboard/reselection enlargement',async()=>{
 vi.mocked(img.getBoundingClientRect).mockImplementation(()=>{
  const html=(useStore.getState().doc.blocks[0].props as {html:string}).html
  const percent=Number(/width:\s*([\d.]+)%/.exec(html)?.[1]??50)
  return {left:20,top:20,width:400*percent/100,height:200*percent/100,right:20+400*percent/100,bottom:20+200*percent/100} as DOMRect
 })
 await pick();await key('Home');await tick()
 expect(host.querySelector('button')).not.toBeNull()
 const smallHandle=host.querySelector('button')!;expect(smallHandle.style.left).toBe('60px');expect(smallHandle.style.top).toBe('40px')
 await key('End');expect((useStore.getState().doc.blocks[0].props as any).html).toContain('100%')
 await tick();await key('Home');await tick();await pick();await key('ArrowUp',true);await tick()
 expect((useStore.getState().doc.blocks[0].props as any).html).toContain('20%')
 for(let i=0;i<6;i++){await key('ArrowUp',true);await tick()}
 expect((useStore.getState().doc.blocks[0].props as any).html).toContain('80%')
})
