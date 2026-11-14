// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach,beforeEach,expect,it,vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Canvas } from '../../src/editor/Canvas'
import { emptyDoc,useStore } from '../../src/editor/store'
import { createBlock } from '../../src/core/blocks'
let host:HTMLDivElement,root:Root
const state=()=>useStore.getState()
const block=(id:string)=>host.querySelector<HTMLElement>(`[data-block-id="${id}"]`)!
const click=(target:Element,opts:MouseEventInit={})=>act(()=>target.dispatchEvent(new MouseEvent('click',{bubbles:true,...opts})))
beforeEach(async()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}})
 vi.stubGlobal('requestAnimationFrame',()=>1);vi.stubGlobal('cancelAnimationFrame',()=>{})
 localStorage.clear();state().load({...emptyDoc(),blocks:['a','b'].map(id=>({...createBlock('html',{html:`<p>${id} text <a href="https://example.test">link</a></p>`}),id}))})
 host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(Canvas)))
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals()})
it('Ctrl and Cmd toggle membership while plain click and blank canvas preserve single selection semantics',()=>{
 click(block('a').querySelector('p')!);click(block('b').querySelector('p')!,{ctrlKey:true});expect(state().selectedIds).toEqual(['a','b'])
 click(block('a').querySelector('p')!,{metaKey:true});expect(state().selectedIds).toEqual(['b'])
 click(block('a').querySelector('p')!);expect(state().selectedIds).toEqual(['a']);click(host.querySelector('.phone-head')!);expect(state().selectedIds).toEqual([])
})
it('touch/keyboard multi-select mode has explicit buttons and never toggles through an interactive child',()=>{
 const mode=host.querySelector<HTMLButtonElement>('[data-testid="multi-select-mode"]')!;expect(mode).not.toBeNull();click(mode)
 const a=block('a').querySelector<HTMLButtonElement>('[data-testid="toggle-block-selection"]')!;const b=block('b').querySelector<HTMLButtonElement>('[data-testid="toggle-block-selection"]')!
 click(a);click(b);expect(state().selectedIds).toEqual(['a','b']);expect(a.getAttribute('aria-pressed')).toBe('true')
 block('a').querySelector('a')!.addEventListener('click',event=>event.preventDefault());click(block('a').querySelector('a')!,{ctrlKey:true});expect(state().selectedIds).toEqual(['a','b'])
 click(mode);expect(host.querySelector('[data-testid="toggle-block-selection"]')).toBeNull()
})
it('modifier selection never starts text editing on double click',()=>{
 click(block('a').querySelector('p')!);click(block('b').querySelector('p')!,{ctrlKey:true})
 act(()=>block('b').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,ctrlKey:true})));expect(state().editingId).toBeNull();expect(state().selectedIds).toEqual(['a','b'])
})
it('editing content and toolbar buttons do not collapse selection through the outer block handler',()=>{
 click(block('a').querySelector('p')!);const p=block('a').querySelector('p')!;p.setAttribute('contenteditable','true')
 click(p,{ctrlKey:true});expect(state().selectedIds).toEqual(['a'])
 click(block('a').querySelector('.block-label')!);expect(state().selectedIds).toEqual(['a'])
})

it('selection mode and markers never enter stored or compiled article content',async()=>{
 const {compileDoc}=await import('../../src/core/compiler');const before=compileDoc(state().doc).html;const doc=state().doc
 click(host.querySelector('[data-testid="multi-select-mode"]')!);click(block('a').querySelector('[data-testid="toggle-block-selection"]')!);click(block('b').querySelector('[data-testid="toggle-block-selection"]')!)
 expect(state().doc).toBe(doc);expect(compileDoc(state().doc).html).toBe(before);expect(before).not.toContain('block-select-toggle')
})

it('sets a 44px selection-bar target outside mobile media queries, including tablet touch',()=>{
 const editorStyles=readFileSync('src/styles.css','utf8')
 const rule=editorStyles.match(/\.canvas-wrap > \.selection-bar button \{([^}]+)\}/)?.[1]
 expect(rule).toBeDefined()
 expect(rule).toMatch(/min-height:\s*44px\s*;/)
})
