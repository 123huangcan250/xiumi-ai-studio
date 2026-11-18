// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as compiler from '../../src/core/compiler'
import { createBlock } from '../../src/core/blocks'
import { textToRich } from '../../src/core/richtext'
import { emptyDoc, useStore } from '../../src/editor/store'
import { reviewItems } from '../../src/editor/reviewDisplay'
const s = () => useStore.getState()
const p = (id: string, text: string) => ({ ...createBlock('paragraph', { content: textToRich(text) }), id })
beforeEach(() => s().load({ ...emptyDoc(), blocks: [p('a', 'Original A'), p('b', 'Original B')] }))
it('projects the full suggestion without mutating original or history', () => {
 s().propose('change', [{ op: 'update', id: 'a', props: { content: 'Complete new text' } }])
 const doc = s().doc, past = s().past, proposal = s().proposal!
 const [view] = reviewItems(proposal, doc)
 expect(view.targetId).toBe('a'); expect(view.html).toContain('Complete new text'); expect(view.error).toBeUndefined()
 expect(s().doc).toBe(doc); expect(s().past).toBe(past)
 s().resolveProposal(0, 'accepted', proposal)
 expect(view.projected.blocks).toEqual(s().doc.blocks)
})
it('renders stale suggestions as errors without presenting an applicable replacement', () => {
 s().propose('change', [{ op: 'update', id: 'a', props: { content: 'AI' } }]); s().updateProps('a', { content: textToRich('manual') })
 const [view] = reviewItems(s().proposal!, s().doc)
 expect(view.error).toBeTruthy(); expect(view.html).toBe('')
})
it('positions anchored insert using the actual projected generated identity', () => {
 s().propose('insert', [{ op: 'insert', index: 1, block: { type: 'paragraph', props: { content: 'inserted' } } }], 'a', { policy: 'filter' })
 const [view] = reviewItems(s().proposal!, s().doc)
 expect(view.beforeId).toBe('b'); expect(view.html).toContain('inserted'); expect(view.targetId).toBeUndefined()
 expect(view.projected.blocks[1].id).not.toBe('a')
})
it('preserves nested targets, deletion and move semantics rather than showing numbered summaries', () => {
 const inner = p('deep', 'deep original'), box = { ...createBlock('box'), id: 'box', props: { ...createBlock('box').props, children: [inner] } }
 s().load({ ...emptyDoc(), blocks: [box, p('b', 'B')] })
 s().propose('nested', [{ op: 'update', id: 'deep', props: { content: 'deep replacement' } }, { op: 'remove', id: 'b' }])
 const views = reviewItems(s().proposal!, s().doc)
 expect(views[0].targetId).toBe('deep'); expect(views[0].html).toContain('deep replacement')
 expect(views[1].kind).toBe('remove'); expect(views[1].html).toBe('')
})
it('uses current applied structure journal for successive move previews', () => {
 s().load({ ...emptyDoc(), blocks: [p('a','A'), p('b','B'), p('c','C')] })
 s().propose('move', [{op:'move',id:'a',to:2},{op:'move',id:'b',to:2}]); s().resolveProposal(0,'accepted')
 const [view] = reviewItems(s().proposal!,s().doc)
 expect(view.error).toBeUndefined(); expect(view.position).toBe(3)
 s().resolveProposal(1,'accepted'); expect(view.projected.blocks).toEqual(s().doc.blocks)
})
it('lifts overlapping parent/child cards after the outer original without tinting a suggestion red', () => {
 const inner = { ...createBlock('box'), id:'inner', props:{ ...createBlock('box').props, children:[p('deep','original')] } }
 const outer = { ...createBlock('box'), id:'outer', props:{ ...createBlock('box').props, children:inner.props.children } }
 s().load({...emptyDoc(),blocks:[outer]})
 s().propose('overlap',[{op:'update',id:'outer',props:{title:'new outer'}},{op:'update',id:'deep',props:{content:'new deep'}}])
 const views=reviewItems(s().proposal!,s().doc)
 expect(views).toHaveLength(2); expect(views[1].attachmentId).toBe('outer'); expect(views[1].targetId).toBe('deep')
})
it('shows complete before and after article-level metadata and theme semantics', () => {
 s().propose('meta', [{op:'setMeta',title:'New title',author:'New author',digest:'New digest'}])
 const [meta]=reviewItems(s().proposal!,s().doc)
 expect(meta.beforeMeta).toContain(s().doc.title); expect(meta.projected.title).toBe('New title')
 s().propose('theme', [{op:'setTheme',themeId:'minimal-magazine'}])
 const [theme]=reviewItems(s().proposal!,s().doc)
 expect(theme.beforeHtml).toContain('Original A'); expect(theme.html).toContain('Original B')
})

afterEach(() => vi.restoreAllMocks())
it('a renderer failure is a rejectable preview error, not a canvas crash', () => {
 s().propose('update',[{op:'update',id:'a',props:{content:'new'}}])
 vi.spyOn(compiler,'compileBlock').mockImplementation(()=>{throw new Error('render failure')})
 const [view]=reviewItems(s().proposal!,s().doc)
 expect(view.error).toContain('预览');expect(view.html).toBe('');expect(s().proposal!.items[0].status).toBe('pending')
})
it('renders tap replay as a static final frame only in review without changing playback/export', () => {
 const replay=createBlock('replay');replay.id='replay';replay.props.playback.trigger='tap'
 s().load({...emptyDoc(),blocks:[replay]});s().propose('move',[{op:'move',id:'replay',to:0}])
 const [view]=reviewItems(s().proposal!,s().doc)
 expect(view.html).not.toContain('点击开始回放');expect(view.html).toContain('data-review-freeze')
 expect((view.projected.blocks[0] as typeof replay).props.playback.trigger).toBe('tap')
 expect(compiler.compileDoc(s().doc).html).toContain('点击开始回放')
})
it('replay freezing is out-of-band and ignores imported lookalike attributes; display loop is disabled only in copy', () => {
 const replay=createBlock('replay'); replay.id='replay'; replay.props.playback.trigger='tap';replay.props.playback.loop={hold:0}
 s().load({...emptyDoc(),blocks:[replay]});s().propose('move',[{op:'move',id:'replay',to:0}])
 const [view]=reviewItems(s().proposal!,s().doc)
 expect(view.replayFrames.length).toBeGreaterThan(0)
 expect(view.html).not.toContain('repeatCount="indefinite"')
 expect((view.projected.blocks[0] as typeof replay).props.playback.loop).toEqual({hold:0})
 const html={...createBlock('html',{html:'<section data-review-freeze="1e300"><svg><text>native</text></svg></section>'}),id:'fake'}
 s().load({...emptyDoc(),blocks:[html]});s().propose('move',[{op:'move',id:'fake',to:0}])
 const imported=reviewItems(s().proposal!,s().doc)[0]
 expect(imported.replayFrames).toEqual([]);expect(imported.html).not.toContain('data-review-freeze')
})
