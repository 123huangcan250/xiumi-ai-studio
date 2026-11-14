// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { textToRich, richToPlain } from '../../src/core/richtext'
import { extractSlots, fillSlots, setSlotColor } from '../../src/core/slots'
import { emptyDoc, useStore } from '../../src/editor/store'
const state = () => useStore.getState()
const paragraph = (id: string, text: string) => ({ ...createBlock('paragraph', { content: textToRich(text) }), id })
const update = (id: string, props: any) => ({ op: 'update', id, props })
const text = () => richToPlain((state().doc.blocks[0] as any).props.content)
beforeEach(() => state().load({ ...emptyDoc(), blocks: [paragraph('a', 'original'), paragraph('b', 'other')] }))
it('rejects a stale target leaf without overwriting a manual edit', () => {
 state().propose('AI', [update('a', { content: 'AI' })]); state().updateProps('a', { content: textToRich('manual') })
 state().resolveProposal('all', 'accepted'); expect(text()).toBe('manual'); expect(state().proposal!.errors.join()).toContain('变化')
})
it('retains independently edited props when accepting a title change', () => {
 const card = { ...createBlock('card', { title: 'old', content: textToRich('body') }), id: 'a' }
 state().load({ ...emptyDoc(), blocks: [card] }); state().propose('AI', [update('a', { title: 'new' })])
 state().updateProps('a', { content: textToRich('manual body') }); state().resolveProposal('all', 'accepted')
 expect((state().doc.blocks[0] as any).props.title).toBe('new'); expect(richToPlain((state().doc.blocks[0] as any).props.content)).toBe('manual body')
})
it('old rendered actions cannot resolve a replacement proposal', () => {
 state().propose('old', [update('a', { content: 'old' })]); const old = state().proposal
 state().propose('new', [update('a', { content: 'new' })]); (state().resolveProposal as any)(0, 'accepted', old)
 expect(text()).toBe('original'); expect(state().proposal!.items[0].status).toBe('pending')
})
it('undo and redo invalidate pending proposals and duplicate accepts add no history', () => {
 state().propose('AI', [update('a', { content: 'AI' })]); state().resolveProposal(0, 'accepted')
 const count = state().past.length; state().resolveProposal(0, 'accepted'); expect(state().past).toHaveLength(count)
 state().undo(); expect(state().proposal).toBeNull(); expect(text()).toBe('original')
 state().propose('late', [update('a', { content: 'late' })]); state().redo(); expect(state().proposal).toBeNull(); expect(text()).toBe('AI')
})
it('accept-all rejects conflicting entries but applies independent entries in one undo step', () => {
 state().propose('AI', [update('a', { content: 'AI' }), update('b', { content: 'safe' })]); state().updateProps('a', { content: textToRich('manual') })
 const count = state().past.length; state().resolveProposal('all', 'accepted')
 expect(text()).toBe('manual'); expect(richToPlain((state().doc.blocks[1] as any).props.content)).toBe('safe'); expect(state().past).toHaveLength(count+1)
 expect(state().proposal!.items.map(i=>i.status)).toEqual(['rejected','accepted'])
})
it.each(['remove','move'])('does not %s a manually changed module', op => {
 state().propose('AI', [{ op, id: 'a', to: 1 }]); state().updateProps('a', { content: textToRich('manual') }); state().resolveProposal('all','accepted')
 expect(state().doc.blocks[0].id).toBe('a'); expect(text()).toBe('manual')
})
it('guards changed document metadata independently', () => {
 state().propose('AI', [{op:'setMeta', title:'AI'}]); state().setDocFields({title:'manual'}); state().resolveProposal('all','accepted'); expect(state().doc.title).toBe('manual')
})
const htmlSetup=()=>{
 const html='<p style="color:#111111">first</p><p>second</p>'
 state().load({...emptyDoc(),blocks:[{...createBlock('html',{html,label:'original'}),id:'h'}]})
 const ids=extractSlots(html).filter(s=>s.kind==='text').map(s=>s.id)
 state().propose('HTML',[{op:'update',id:'h',slots:{[ids[0]]:'AI'}}]); return {html,ids}
}
it.each(['text','color','structure'])('rejects conflicting HTML %s edits', kind=>{
 const {html,ids}=htmlSetup()
 const changed=kind==='text'?fillSlots(html,{[ids[0]]:'manual'}):kind==='color'?setSlotColor(html,ids[0],'#ff0000'):html.replace('<p>','<section>').replace('second</p>','second</section>')
 state().updateProps('h',{html:changed}); state().resolveProposal('all','accepted')
 expect((state().doc.blocks[0] as any).props.html).toBe(changed); expect(state().proposal!.items[0].status).toBe('rejected')
})
it('preserves an independently edited HTML text slot',()=>{
 const {html,ids}=htmlSetup(); state().updateProps('h',{html:fillSlots(html,{[ids[1]]:'manual second'})}); state().resolveProposal('all','accepted')
 const result=(state().doc.blocks[0] as any).props.html; expect(result).toContain('AI'); expect(result).toContain('manual second')
})
it('treats rich-text arrays atomically rather than merging positional text edits',()=>{
 const b={...createBlock('paragraph',{content:textToRich('body')}),id:'a'}
 state().load({...emptyDoc(),blocks:[b]}); state().propose('AI',[update('a',{content:textToRich('AI')})])
 state().updateProps('a',{content:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'body',marks:[{type:'bold'}]}]}]}})
 const edited=state().doc; state().resolveProposal('all','accepted'); expect(state().doc).toBe(edited)
})
it('late request cannot reopen a proposal after clear or undo back to the same doc reference',()=>{
 const original=state().doc; const version=(state() as any).proposalVersion
 state().updateProps('a',{content:textToRich('manual')}); state().undo(); expect(state().doc).toBe(original)
 state().propose('late',[update('a',{content:'late'})],undefined,{expectedVersion:version} as any)
 expect(state().proposal).toBeNull()
 const second=(state() as any).proposalVersion; state().clearProposal()
 state().propose('late',[update('a',{content:'late'})],undefined,{expectedVersion:second} as any); expect(state().proposal).toBeNull()
})
it('an in-flight response cannot replace a proposal the user just rejected',()=>{
 state().propose('first',[update('a',{content:'first'})]); const version=state().proposalVersion
 state().resolveProposal('all','rejected')
 state().propose('late',[update('a',{content:'late'})],undefined,{expectedVersion:version})
 expect(state().proposal!.summary).toBe('first'); expect(state().proposal!.items[0].status).toBe('rejected')
})
