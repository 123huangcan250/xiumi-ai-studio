// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { compileBlock } from '../../src/core/compiler'
import { createBlock } from '../../src/core/blocks'
import { resolveTheme } from '../../src/core/themes'
import type { RichNode } from '../../src/core/types'
const theme=resolveTheme({themeId:'minimal-magazine'})
const text=(value:string,marks?:RichNode['marks']):RichNode=>({type:'text',text:value,marks})
const render=(content:RichNode[],type='paragraph')=>compileBlock(createBlock('paragraph',{content:{type:'doc',content:[{type,content}]}}),theme,{externalLinks:'keep'})
const parse=(html:string)=>new DOMParser().parseFromString(html,'text/html')
it('keeps ordinary break opportunities across bold text nodes in English and Chinese mixtures',()=>{
 for(const words of [['Visit ','Tsinghua',' University'],['参观 ','清华 University',' 校园']]){
 const html=render([text(words[0]),text(words[1],[{type:'bold'}]),text(words[2])]);expect(html).not.toContain('&nbsp;');expect(parse(html).body.textContent).toBe(words.join(''));expect(parse(html).querySelector('strong')?.textContent).toBe(words[1])
 }
})
it('does not glue links and styled marks to neighbouring words',()=>{
 const html=render([text('Go '),text('there',[{type:'link',attrs:{href:'https://example.com/?a=1&b=2'}},{type:'italic'},{type:'textStyle',attrs:{color:'#123456'}}]),text(' now')]);expect(html).not.toContain('&nbsp;');expect(parse(html).body.textContent).toBe('Go there now');expect(parse(html).querySelector('a')?.getAttribute('href')).toBe('https://example.com/?a=1&b=2');expect(parse(html).querySelector('em')).not.toBeNull();expect(html).toContain('#123456')
})
it('preserves repeated spaces even when the run crosses several mark boundaries',()=>{
 const html=render([text('A '),text(' ',[{type:'bold'}]),text(' B')]);expect(parse(html).body.textContent).toBe('A'+String.fromCharCode(160).repeat(3)+'B');expect(html.match(/&nbsp;/g)).toHaveLength(3)
})
it('preserves paragraph and hard-break edge spaces without preserving unrelated node edges',()=>{
 const html=render([text(' Leading '),text('bold ',[{type:'bold'}]),{type:'hardBreak'},text(' next '),text('end ')]);expect(parse(html).body.textContent).toBe(' Leading bold  next end ');expect(html.match(/&nbsp;/g)).toHaveLength(4);expect(parse(html).querySelectorAll('br')).toHaveLength(1)
})
it('uses heading and list paragraph boundaries and ignores empty text nodes',()=>{
 const nodes=[text('A '),text('',[{type:'bold'}]),text('B')];expect(render(nodes,'heading')).not.toContain('&nbsp;')
 const html=compileBlock(createBlock('paragraph',{content:{type:'doc',content:[{type:'bulletList',content:[{type:'listItem',content:[{type:'paragraph',content:nodes},{type:'paragraph',content:[text(' next ')]}]}]}]}}),theme);expect(parse(html).body.textContent).toContain('A B\u00a0next\u00a0');expect(html.match(/&nbsp;/g)).toHaveLength(2);expect(parse(html).querySelectorAll('br')).toHaveLength(1)
})
it('preserves escaping and leaves authored raw HTML whitespace unchanged',()=>{
 const html=render([text('A<& '),text('B',[{type:'bold'}])]);expect(html).toContain('A&lt;&amp; ');expect(html).not.toContain('&nbsp;')
 const raw='<p>Visit <strong>Tsinghua</strong> University</p>';expect(compileBlock(createBlock('html',{html:raw}),theme)).toContain(raw)
})

it('does not treat a literal text newline as an explicit hard break',()=>{
 const html=render([text('A \n'),text(' B')]);expect(html).not.toContain('&nbsp;');expect(parse(html).body.textContent).toBe('A \n B');expect(parse(html).querySelectorAll('br')).toHaveLength(0)
})
