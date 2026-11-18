// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { textToRich } from '../../src/core/richtext'
import { emptyDoc, useStore } from '../../src/editor/store'
import { ReviewProvider, ReviewBlock } from '../../src/editor/InlineReview'
let root: Root, host: HTMLDivElement
const s = () => useStore.getState()
beforeEach(() => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
 s().load({ ...emptyDoc(), blocks: [{ ...createBlock('paragraph', { content: textToRich('original') }), id: 'a' }] })
 host = document.createElement('div'); document.body.append(host); root = createRoot(host)
 act(() => root.render(h(ReviewProvider, null, h(ReviewBlock, { id: 'a' }, h('input', { 'data-testid': 'original', defaultValue: 'editing' })))))
})
afterEach(() => { act(() => root.unmount()); host.remove() })
it('keeps the original node mounted and shows full suggestion below with explicit actions', () => {
 const original = host.querySelector('input')!; original.focus()
 act(() => s().propose('AI', [{ op: 'update', id: 'a', props: { content: 'new full content' } }]))
 expect(host.querySelector('input')).toBe(original); expect(document.activeElement).toBe(original)
 expect(host.querySelector('.review-original-red')).toBeTruthy()
 const frame = host.querySelector('iframe')!; expect(frame.srcdoc).toContain('new full content')
 expect(frame.getAttribute('sandbox')).toBe('allow-same-origin'); expect(frame.tabIndex).toBe(-1)
 expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(['接受', '拒绝'])
 const accept = host.querySelector('button')!
 act(() => { accept.click(); accept.click() })
 expect(s().past).toHaveLength(1); expect(host.querySelector('input')).toBe(original)
 act(() => s().undo()); expect(s().proposal).toBeNull()
})
it('stale replacement cannot be accepted but can be dismissed', () => {
 act(() => s().propose('AI', [{ op: 'update', id: 'a', props: { content: 'new' } }]))
 act(() => s().updateProps('a', { content: textToRich('manual') }))
 expect(host.querySelector<HTMLButtonElement>('.review-accept')!.disabled).toBe(true)
 expect(host.querySelector('[role="status"]')?.textContent).toContain('变化')
 const before = s().doc
 act(() => host.querySelector<HTMLButtonElement>('.review-reject')!.click())
 expect(s().doc).toBe(before); expect(host.querySelector('iframe')).toBeNull()
})
it('review clicks and Delete keys do not reach article selection or deletion handlers', () => {
 act(() => s().propose('AI', [{ op: 'update', id: 'a', props: { content: 'new' } }]))
 let calls=0
 const outer=()=>{calls++}
 document.addEventListener('click',outer);document.addEventListener('keydown',outer)
 const reject=host.querySelector<HTMLButtonElement>('.review-reject')!
 act(()=>{reject.dispatchEvent(new KeyboardEvent('keydown',{key:'Delete',bubbles:true}));reject.click()})
 expect(calls).toBe(0);expect(s().doc.blocks).toHaveLength(1)
 document.removeEventListener('click',outer);document.removeEventListener('keydown',outer)
})
it('preview frame strips active content and never becomes article/export data', async () => {
 const {compileDoc}=await import('../../src/core/compiler')
 const block={...createBlock('html',{html:'<p>safe original</p>'}),id:'a'}
 act(()=>s().load({...emptyDoc(),blocks:[block]}))
 // HTML slots are the only accepted update language; unsafe stored source is still guarded at preview output.
 const doc={...s().doc,blocks:[{...block,props:{...block.props,html:'<p onclick="alert(1)">safe original</p><a href="java&#x73;cript:alert(1)">link</a>'}}]}
 act(()=>s().load(doc))
 act(()=>s().propose('move',[{op:'move',id:'a',to:0}]))
 const frame=host.querySelector('iframe')!
 expect(frame.srcdoc).not.toContain('onclick=');expect(frame.srcdoc).not.toContain('href="javascript:')
 expect(frame.srcdoc).toContain("script-src 'none'")
 expect(compileDoc(s().doc).html).not.toMatch(/review-suggestion|review-bubble|修改建议/)
 expect(JSON.stringify(s().doc)).not.toContain('review-suggestion')
})
it('failed SMIL freezing is disclosed and does not stop frame height measurement', () => {
 const replay=createBlock('replay');replay.id='a';replay.props.playback.trigger='tap'
 act(()=>{s().load({...emptyDoc(),blocks:[replay]});s().propose('move',[{op:'move',id:'a',to:0}])})
 const frame=host.querySelector('iframe')!
 const doc=frame.contentDocument!
 doc.body.innerHTML=new DOMParser().parseFromString(frame.srcdoc,'text/html').body.innerHTML
 doc.querySelectorAll('svg').forEach(svg=>{svg.pauseAnimations=()=>{throw new Error('unsupported')}})
 Object.defineProperty(doc.body,'scrollHeight',{value:420,configurable:true})
 act(()=>frame.dispatchEvent(new Event('load')))
 expect(host.textContent).toContain('不支持静态定格')
 expect(frame.style.height).toBe('420px')
})
