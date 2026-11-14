import {afterEach,expect,it,vi} from 'vitest'
import {selectionPolicy} from '../../server/aiEdit'
import {limitToSelection,selectionScope} from '../../src/core/ops'
const b=(id:string)=>({id,type:'paragraph',props:{}})
afterEach(()=>vi.unstubAllEnvs())
it.each([' FILTER ','Filter',' filter '])('normalizes explicit filter configuration %s',value=>{vi.stubEnv('AI_SELECTION_POLICY',value);expect(selectionPolicy()).toBe('filter')})
it('unknown policy remains fail-closed strict',()=>{vi.stubEnv('AI_SELECTION_POLICY','typo');expect(selectionPolicy()).toBe('strict')})
it('normalizes whole string insertion index within the same boundary',()=>{const doc={blocks:[b('a'),b('selected'),b('c')]};const item={op:'insert',index:'2',block:{type:'paragraph'}};expect(limitToSelection(doc,'selected',[item],'filter').ops).toEqual([{...item,index:2,anchor:{id:'selected',side:'after'}}]);expect(limitToSelection(doc,'selected',[item],'strict').ops).toEqual([])})
it.each(['',true,null,[],{},'2.5','Infinity'])('rejects non-whole index %j',index=>{expect(limitToSelection({blocks:[b('s')]},'s',[{op:'insert',index}], 'filter').ops).toEqual([])})
it('does not reject valid selection because of unrelated malformed or repeated IDs',()=>{expect(selectionScope({blocks:[b('s'),b('dup'),b('dup'),b('')]},'s')?.ids).toEqual(new Set(['s']))})
it('rejects selected or descendant identity ambiguity anywhere in the document',()=>{expect(selectionScope({blocks:[b('s'),b('s')]},'s')).toBeNull();expect(selectionScope({blocks:[{id:'s',type:'box',props:{children:[b('child')]}},b('child')]},'s')).toBeNull()})
it('rejects missing descendant identity but preserves unique nested selection beside unrelated malformed data',()=>{expect(selectionScope({blocks:[{id:'s',type:'box',props:{children:[b('')]}}]},'s')).toBeNull();expect(selectionScope({blocks:[{id:'parent',type:'box',props:{children:[b('s'),b('')]}},b('dup'),b('dup')]},'s')?.ids).toEqual(new Set(['s']))})

it('does not anchor adjacent insert to an invalid or ambiguous parent identity',()=>{
 for(const blocks of [[{id:'',type:'box',props:{children:[b('s')]}}],[{id:'parent',type:'box',props:{children:[b('s')]}},b('parent')]]) {
  const result=limitToSelection({blocks},'s',[{op:'update',id:'s',props:{}},{op:'insert',index:1}],'filter')
  expect(result.ops).toEqual([{op:'update',id:'s',props:{}}]);expect(result.dropped).toHaveLength(1)
 }
})
