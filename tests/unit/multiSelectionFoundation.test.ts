// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { limitToSelection, applyOps } from '../../src/core/ops'
import { resolveEditSelection, prepareEdit } from '../../server/aiEdit'
import { createBlock } from '../../src/core/blocks'
import { aiContext } from '../../src/core/quickActions'
import { emptyDoc, useStore } from '../../src/editor/store'
vi.mock('../../src/editor/api',()=>({api:{saveProject:vi.fn(async(d)=>d)}}))
const p=(id:string)=>({...createBlock('paragraph'),id})
const doc=()=>({...emptyDoc(),blocks:[{...createBlock('box'),id:'box',props:{...createBlock('box').props,children:[p('child')]}},p('b'),p('c')]})
const state=()=>useStore.getState()
beforeEach(()=>state().load(doc()))
it('filter unions selected subtrees without admitting unselected siblings or metadata',()=>{
 const ops=[{op:'update',id:'child',props:{content:'x'}},{op:'remove',id:'b'},{op:'update',id:'c'},{op:'setTheme',themeId:'x'}]
 expect(limitToSelection(doc(),['box','b'] as any,ops,'filter')).toEqual({ops:ops.slice(0,2),dropped:ops.slice(2)})
})
it('strict remains atomic update-only across all selected subtrees',()=>{
 const ops=[{op:'update',id:'child'},{op:'update',id:'b'}]
 expect(limitToSelection(doc(),['box','b'] as any,ops,'strict').ops).toEqual(ops)
 expect(limitToSelection(doc(),['box','b'] as any,[...ops,{op:'remove',id:'b'}],'strict').ops).toEqual([])
})
it('shared gap picks document-first anchor regardless of click order and honors a valid explicit alternative',()=>{
 const op={op:'insert',index:'1',block:p('new')}
 for(const ids of [['box','b'],['b','box']]) expect(limitToSelection(doc(),ids as any,[op],'filter').ops[0]).toMatchObject({index:1,anchor:{id:'box',side:'after'}})
 expect(limitToSelection(doc(),['box','b'] as any,[{...op,anchor:{id:'b',side:'before'}}],'filter').ops).toHaveLength(1)
 expect(limitToSelection(doc(),['box','b'] as any,[{...op,anchor:{id:'c',side:'before'}}],'filter').ops).toEqual([])
})
it.each([[],['b','b'],['missing'],['b','missing']].map(ids=>[ids]))('invalid selected list %j never grants document scope', ids=>{
 const ops=[{op:'setTheme',themeId:'x'}]
 expect(limitToSelection(doc(),ids as any,ops,'filter')).toEqual({ops:[],dropped:ops})
 expect(()=> (resolveEditSelection as any)(doc(),undefined,ids)).toThrow()
})
it('duplicate selected identities fail closed while unrelated duplicate IDs do not invalidate selection',()=>{
 const d=doc();d.blocks.push(p('b'));expect(()=> (resolveEditSelection as any)(d,undefined,['box','b'])).toThrow()
 expect((resolveEditSelection as any)(d,undefined,['box','c'])).toEqual(['box','c'])
})
it('request ids, primary and focus must agree; old single focus still resolves',()=>{
 const d={...doc(),focus:{ids:['b','box'],id:'b'}}
 expect((resolveEditSelection as any)(d,'b',['box','b'])).toEqual(['box','b'])
 expect(()=> (resolveEditSelection as any)(d,'c',['box','b'])).toThrow()
 expect(()=> (resolveEditSelection as any)({...d,focus:{ids:['b','c']}},undefined,['box','b'])).toThrow()
 expect(resolveEditSelection({...doc(),focus:{id:'b'}},'b')).toBe('b')
})
it('server retains filter count and strict failure for the multi request',()=>{
 const filter=(prepareEdit as any)(doc(),undefined,'filter',['box','b'])
 const ops=[{op:'remove',id:'b'},{op:'update',id:'c'}]
 expect(filter.result({ops,selectionPolicy:'strict',ignoredOps:999})).toMatchObject({ops:[ops[0]],ignoredOps:1,selectionPolicy:'filter'})
 expect(filter.prompt('edit')).toContain('box');expect(filter.prompt('edit')).toContain('b')
 expect(()=>(prepareEdit as any)(doc(),undefined,'strict',['box','b']).result({ops})).toThrow()
})
it('context keeps original top indices and full selected ancestors with summary neighbors',()=>{
 const c=aiContext(doc(),['child','b'] as any)
 expect(c.focus).toMatchObject({ids:['child','b']})
 expect(c.blocks.map(b=>b.index)).toEqual([0,1,2]);expect(c.blocks[0]).toHaveProperty('props.children');expect(c.blocks[1]).toHaveProperty('props');expect(c.blocks[2]).toHaveProperty('summary')
})
it('toggle keeps primary inside selected set and ordinary selection collapses it',()=>{
 state().select('box');(state().select as any)('b',{toggle:true});expect((state() as any).selectedIds).toEqual(['box','b']);expect(state().selectedId).toBe('b')
 ;(state().select as any)('b',{toggle:true});expect(state().selectedId).toBe('box');state().select('c');expect((state() as any).selectedIds).toEqual(['c']);state().select(null);expect((state() as any).selectedIds).toEqual([])
})
it('parent-child batch removal commits once and undo/redo never revives review',()=>{
 state().select('box');(state().select as any)('child',{toggle:true});(state().select as any)('b',{toggle:true})
 state().propose('old',[{op:'update',id:'c',props:{content:'old'}}]);const n=state().past.length
 ;(state() as any).removeSelected();expect(state().doc.blocks.map(b=>b.id)).toEqual(['c']);expect(state().past).toHaveLength(n+1);expect((state() as any).selectedIds).toEqual([])
 state().undo();expect(state().doc.blocks.map(b=>b.id)).toEqual(['box','b','c']);expect(state().proposal).toBeNull();state().redo();expect(state().doc.blocks.map(b=>b.id)).toEqual(['c']);expect(state().proposal).toBeNull()
})
it('single edit and picking narrow a multi selection; deletion clears invalid descendants',()=>{
 state().select('box');(state().select as any)('b',{toggle:true});state().setEditing('b');expect((state() as any).selectedIds).toEqual(['b'])
 state().select('child');(state().select as any)('c',{toggle:true});state().removeBlock('box');expect((state() as any).selectedIds).toEqual(['c']);state().setPicking('c');expect((state() as any).selectedIds).toEqual(['c'])
})
it('multi proposal filtering still permits remove and stable sibling inserts accepted in reverse',()=>{
 const ops=[{op:'insert',index:1,block:p('one')},{op:'insert',index:1,block:p('two')},{op:'remove',id:'b'}]
 state().propose('multi',ops,['box','b'] as any,{policy:'filter'});expect(state().proposal!.items).toHaveLength(3)
 const preview=applyOps(state().doc,state().proposal!.items.map(i=>i.op));state().resolveProposal(1,'accepted');state().resolveProposal(0,'accepted');state().resolveProposal(2,'accepted');expect(state().doc.blocks.map(b=>b.type)).toEqual(preview.blocks.map(b=>b.type))
 expect(state().proposal!.items.every(i=>i.status==='accepted')).toBe(true)
})
it('does not widen a legacy single focus into a larger explicit selected array',()=>{
 expect(()=>resolveEditSelection({...doc(),focus:{id:'b'}},'b',['box','b'])).toThrow()
 expect(resolveEditSelection({...doc(),focus:{id:'b'}},'b',['b'])).toEqual(['b'])
})
it('context refuses ambiguous selected IDs before serializing anything',()=>{
 const d=doc();d.blocks.push(p('b'));expect(()=>aiContext(d,['b','c'])).toThrow()
 expect(()=>aiContext(d,[])).toThrow()
})
it('selection entry rejects duplicate identities and document switch clears every UI reference',()=>{
 const d=doc();d.blocks.push(p('b'));state().load(d);state().select('b');expect(state().selectedId).toBeNull()
 state().select('child');state().select('c',{toggle:true});state().load({...doc(),id:'new'});expect(state().selectedIds).toEqual([]);expect(state().selectedId).toBeNull()
})
it('insert, duplicate and replacement all establish coherent single selection; stale replay update remains rejected',()=>{
 state().select('box');state().select('b',{toggle:true});const id=state().insertBlock('paragraph');expect(state().selectedIds).toEqual([id])
 state().duplicateBlock('b');expect(state().selectedIds).toEqual([state().selectedId]);state().replaceBlock('b',[p('replaced')]);expect(state().selectedIds).toEqual(['replaced'])
 const replay={...createBlock('replay'),id:'replay'};state().load({...doc(),blocks:[replay,p('b')]});state().propose('invalid replay',[{op:'update',id:'replay',props:{title:'x'}}],['replay','b'],{policy:'filter'});expect(state().proposal!.items).toEqual([])
})
it('overlapping parent and child scope is a union, excludes sibling of child-only selection',()=>{
 const d=doc();(d.blocks[0].props as any).children.push(p('sibling'))
 const ops=[{op:'update',id:'child'},{op:'update',id:'sibling'}]
 expect(limitToSelection(d,['box','child'],ops,'strict').ops).toEqual(ops)
 expect(limitToSelection(d,['child','b'],ops,'filter')).toEqual({ops:[ops[0]],dropped:[ops[1]]})
})
it('multi anchored insertion follows a moved root but refuses a deleted anchor without disturbing other accepted items',()=>{
 state().propose('inserts',[{op:'insert',index:0,block:p('one')},{op:'insert',index:3,block:p('two')}],['box','c'],{policy:'filter'})
 state().moveBlock('box',2);state().resolveProposal(0,'accepted');const firstId=(state().proposal!.items[0].op as any).block.id;expect(state().doc.blocks.findIndex(b=>b.id===firstId)+1).toBe(state().doc.blocks.findIndex(b=>b.id==='box'))
 state().removeBlock('c');state().resolveProposal(1,'accepted');expect(state().proposal!.items.map(i=>i.status)).toEqual(['accepted','rejected'])
})
it('context does not treat an explicit empty scalar selection as whole document',()=>{
 expect(()=>aiContext(doc(),'')).toThrow()
 expect(aiContext(doc(),undefined).blocks.every(b=>'props' in b)).toBe(true)
 expect(aiContext(doc(),null).blocks.every(b=>'props' in b)).toBe(true)
})
it('single removeSelected retains existing neighbor selection behavior',()=>{
 state().select('b');state().removeSelected();expect(state().selectedId).toBe('c');expect(state().selectedIds).toEqual(['c'])
})
it('bulk insertion and moving retain valid multi selection while every structural commit prunes removed ids',()=>{
 state().select('child');state().select('b',{toggle:true});state().insertBlocks([p('inserted')]);expect(state().selectedIds).toEqual(['child','b']);expect(state().selectedId).toBe('b')
 state().moveBlockTo('b','box',0);expect(state().selectedIds).toEqual(['child','b']);state().moveBlock('b',1);expect(state().selectedIds).toEqual(['child','b'])
 state().commit({...state().doc,blocks:state().doc.blocks.filter(b=>b.id!=='box')});expect(state().selectedIds).toEqual([]);expect(state().selectedId).toBeNull()
})
