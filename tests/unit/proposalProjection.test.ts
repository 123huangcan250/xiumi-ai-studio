// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { richToPlain, textToRich } from '../../src/core/richtext'
import { emptyDoc, useStore } from '../../src/editor/store'
import { previewProposal } from '../../src/editor/proposalSafety'
const state=()=>useStore.getState()
const para=(id:string,text:string)=>({...createBlock('paragraph',{content:textToRich(text)}),id})
const texts=()=>state().doc.blocks.map(b=>richToPlain((b as any).props.content))
beforeEach(()=>state().load({...emptyDoc(),blocks:[para('a','A'),para('b','B'),para('c','C')]}))
it.each([[0,1,2],[2,1,0],[1,2,0]].map(order=>[order]))('retains upstream anchored insertion ordering %j',order=>{
 state().propose('insert',['first','second','third'].map(content=>({op:'insert',index:2,block:{type:'paragraph',props:{content}}})),'b',{policy:'filter',ignoredOps:2})
 const before=state().doc, proposal=state().proposal!, snapshot=JSON.stringify(proposal)
 const preview=previewProposal(proposal,before)
 expect(state().doc).toBe(before); expect(JSON.stringify(proposal)).toBe(snapshot)
 expect(preview.blocks.map(b=>richToPlain((b as any).props.content))).toEqual(['A','B','first','second','third','C'])
 for(const i of order)state().resolveProposal(i,'accepted')
 expect(texts()).toEqual(['A','B','first','second','third','C']); expect(state().proposal!.ignoredOps).toBe(2); expect(state().proposal!.selectionPolicy).toBe('filter')
})
it('anchored insert follows a moved anchor, not the original numeric location',()=>{
 state().propose('insert',[{op:'insert',index:2,block:{type:'paragraph',props:{content:'new'}}}],'b',{policy:'filter'})
 state().moveBlockTo('b',null,0); state().resolveProposal('all','accepted'); expect(texts()).toEqual(['B','new','A','C'])
})
it('numeric-only insert refuses a changed order instead of guessing an unrelated position',()=>{
 state().propose('insert',[{op:'insert',index:1,block:{type:'divider'}}]); state().moveBlockTo('b',null,0)
 const before=state().doc; state().resolveProposal('all','accepted'); expect(state().doc).toBe(before); expect(state().proposal!.errors.join()).toContain('顺序')
})
it('preview skips stale items exactly like acceptance and never changes history',()=>{
 state().propose('AI',[{op:'update',id:'a',props:{content:'AI'}},{op:'update',id:'b',props:{content:'safe'}}]); state().updateProps('a',{content:textToRich('manual')})
 const doc=state().doc, proposal=state().proposal!, past=state().past; const preview=previewProposal(proposal,doc)
 expect(state().doc).toBe(doc); expect(state().past).toBe(past); expect(proposal.items.every(i=>i.status==='pending')).toBe(true)
 state().resolveProposal('all','accepted'); expect(state().doc.blocks).toEqual(preview.blocks)
})
it('reject all is history-free and later acceptance cannot revive it',()=>{
 state().propose('AI',[{op:'update',id:'a',props:{content:'AI'}}]); const doc=state().doc,past=state().past
 state().resolveProposal('all','rejected'); state().resolveProposal('all','accepted'); expect(state().doc).toBe(doc); expect(state().past).toBe(past)
})
it('document load invalidates captured actions even if IDs are reused',()=>{
 state().propose('AI',[{op:'update',id:'a',props:{content:'old'}}]); const old=state().proposal!
 state().load({...emptyDoc(),blocks:[para('a','new doc')]}); state().propose('new',[{op:'update',id:'a',props:{content:'new suggestion'}}])
 state().resolveProposal('all','accepted',old); expect(texts()).toEqual(['new doc'])
})
it('theme changes reject stale theme proposals but unrelated author edits do not block title',()=>{
 state().propose('theme',[{op:'setTheme',themeId:'anything'}]); state().setDocFields({themeOverrides:{fontSize:20}}); state().resolveProposal('all','accepted'); expect(state().proposal!.items[0].status).toBe('rejected')
 state().propose('title',[{op:'setMeta',title:'AI title'}]); state().setDocFields({author:'manual author'}); state().resolveProposal('all','accepted'); expect(state().doc.title).toBe('AI title'); expect(state().doc.author).toBe('manual author')
})
it.each([[0,1],[1,0]].map(order=>[order]))('preserves sequential moves accepted in actual order %j',order=>{
 state().propose('moves',[{op:'move',id:'a',to:2},{op:'move',id:'b',to:2}])
 for(const i of order)state().resolveProposal(i,'accepted')
 expect(state().proposal!.items.map(i=>i.status)).toEqual(['accepted','accepted'])
 expect(texts()).toEqual(order[0]===0?['C','A','B']:['C','B','A'])
})
it('preview and accept-all preserve a batch of multiple moves',()=>{
 state().propose('moves',[{op:'move',id:'a',to:2},{op:'move',id:'b',to:2}]); const proposal=state().proposal!,doc=state().doc
 const preview=previewProposal(proposal,doc); expect(preview.blocks.map(b=>b.id)).toEqual(['c','a','b'])
 state().resolveProposal('all','accepted'); expect(state().doc.blocks).toEqual(preview.blocks); expect(state().proposal!.items.every(i=>i.status==='accepted')).toBe(true)
})
it('does not hide an external reorder after a successful proposal move',()=>{
 state().propose('moves',[{op:'move',id:'a',to:2},{op:'move',id:'b',to:2}]); state().resolveProposal(0,'accepted')
 state().moveBlockTo('c',null,0); const doc=state().doc; state().resolveProposal(1,'accepted')
 expect(state().doc).toBe(doc); expect(state().proposal!.items[1].status).toBe('rejected')
})
it('tracks generated insert identities and removal before a numeric move',()=>{
 state().propose('mixed',[{op:'insert',index:1,block:{type:'paragraph',props:{content:'new'}}},{op:'remove',id:'c'},{op:'move',id:'a',to:2}])
 state().resolveProposal(0,'accepted'); state().resolveProposal(1,'accepted'); state().resolveProposal(2,'accepted')
 expect(state().proposal!.items.every(i=>i.status==='accepted')).toBe(true); expect(texts()).toEqual(['new','B','A'])
})
