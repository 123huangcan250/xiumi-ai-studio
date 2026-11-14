// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import type { Block } from '../../src/core/types'

const h = vi.hoisted(() => ({ state: {} as any, compile: vi.fn(), photos: vi.fn(), swap: vi.fn(), save: vi.fn(), collect: vi.fn(), sanitize: vi.fn(), anchor: vi.fn(), place: vi.fn(), pick: vi.fn(), expand: vi.fn(), fragment: vi.fn(), split: vi.fn(), inline: null as null | ((html: string) => boolean), off: vi.fn(), rich: [] as any[], over: false, dragging: false }))
vi.mock('../../src/editor/store', () => ({ useStore: Object.assign((selector: any) => selector(h.state), { getState: () => h.state }) }))
vi.mock('../../src/core/compiler', () => ({ compileBlock: h.compile, rootStyle: () => 'color:#111', blockGap: () => 12, BOX_GAP: 8 }))
vi.mock('../../src/core/photos', () => ({ blockPhotos: h.photos, swapPhotos: h.swap }))
vi.mock('../../src/core/sanitize', () => ({ sanitizeHtml: h.sanitize }))
vi.mock('../../src/core/wxImport', () => ({ splitHtmlBlock: h.split }))
vi.mock('../../src/core/images', () => ({ displayHtml: (s: string) => s, storedHtml: (s: string) => s }))
vi.mock('../../src/core/fragments', () => ({ insertionAnchor: h.anchor, placeFragment: h.place, pickElement: h.pick, expandPick: h.expand, fragmentHtml: h.fragment }))
vi.mock('../../src/core/kit', () => ({ boxParts: () => ({ outer: '', header: '', body: '', footer: '' }), boxTheme: (t: any) => ({ ...t, fontSize: 14 }) }))
vi.mock('@dnd-kit/core', () => ({ useDroppable: () => ({ setNodeRef: vi.fn(), isOver: h.over }) }))
vi.mock('@dnd-kit/sortable', () => ({ SortableContext: ({ children }: { children: ReactNode }) => children, verticalListSortingStrategy: null, useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), setActivatorNodeRef: vi.fn(), transform: null, transition: undefined, isOver: h.over, isDragging: h.dragging }) }))
vi.mock('../../src/editor/InlineReview', () => ({ ReviewProvider: ({ children }: { children: ReactNode }) => children, ReviewBlock: ({ children }: { children: ReactNode }) => children, ReviewSlot: () => null }))
vi.mock('../../src/editor/ReplayPreview', () => ({ ReplayCanvasBody: () => createElement('div',{'data-testid':'replay-child'}) }))
vi.mock('../../src/editor/BlockTextEditor', () => ({ BlockTextEditor: () => null }))
vi.mock('../../src/editor/RichEditor', () => ({ RichEditor: () => null }))
vi.mock('../../src/editor/api', () => ({ api: { saveTemplate: h.save } }))
vi.mock('../../src/editor/componentActions', () => ({ openCollect: h.collect, setInlineTarget: (fn: any) => { h.inline = fn; return h.off } }))
import { Canvas } from '../../src/editor/Canvas'

let host: HTMLDivElement, root: Root
const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
let actDescriptor: PropertyDescriptor | undefined
const render = () => act(async () => { root.render(createElement(Canvas)) })
const mount = async (blocks: Block[]) => { h.state.doc = { ...h.state.doc, blocks }; await render() }
const query = (s: string) => { const node = host.querySelector(s); expect(node, s).toBeTruthy(); return node! }
const event = (el: EventTarget, e: Event) => act(async () => { el.dispatchEvent(e) })
const click = (el: EventTarget, init: MouseEventInit = {}) => event(el, new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
const select = (b: Block) => { h.state.selectedId = b.id; h.state.selectedIds = [b.id] }
beforeEach(() => {
  vi.clearAllMocks(); actDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear()
  h.over = h.dragging = false; h.rich = []; h.inline = null
  h.compile.mockImplementation((b: Block) => b.type === 'html' ? b.props.html : '<p>Preview</p>')
  h.photos.mockImplementation((b: Block) => b.type === 'html' ? Array.from(new DOMParser().parseFromString(b.props.html, 'text/html').querySelectorAll('img')).map(() => ({})) : [])
  h.sanitize.mockImplementation((html: string) => html); h.swap.mockImplementation(doc => doc); h.save.mockResolvedValue({}); h.split.mockReturnValue(null)
  h.pick.mockImplementation((el: Element) => el); h.expand.mockReturnValue(null); h.fragment.mockReturnValue('<p>Collected</p>'); h.anchor.mockReturnValue(null); h.place.mockReturnValue([])
  h.state = { doc: { id: 'doc', title: 'Title', author: 'Author', themeId: 'tsinghua-purple', blocks: [] }, selectedId: null, selectedIds: [], editingId: null, pickingId: null, select: vi.fn(), setEditing: vi.fn(), setPicking: vi.fn(), updateProps: vi.fn(), removeBlock: vi.fn(), replaceBlock: vi.fn(), duplicateBlock: vi.fn(), moveBlock: vi.fn(), moveBlockTo: vi.fn(), notify: vi.fn(), commit: vi.fn(), undo: vi.fn() }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.spyOn(window, 'prompt').mockReturnValue('Saved')
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); if (scrollDescriptor) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollDescriptor); else delete (Element.prototype as any).scrollIntoView; vi.restoreAllMocks(); if (actDescriptor) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', actDescriptor); else delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT })

it.each(['{not json', JSON.stringify({blockId:'broken"[',index:0})])('malformed photo payload is ignored without an uncaught event error: %s', async raw => {
  const b=createBlock('html',{html:'<img src="https://example.test/target">'});await mount([b]);const errors: unknown[]=[]
  const onError=(e:ErrorEvent)=>{errors.push(e.error);e.preventDefault()};window.addEventListener('error',onError)
  try { const drop=new MouseEvent('drop',{bubbles:true,cancelable:true});Object.defineProperty(drop,'dataTransfer',{value:{types:['application/x-xiumi-photo'],getData:()=>raw}});await event(query('img'),drop) } finally { window.removeEventListener('error',onError) }
  expect(errors).toEqual([]);expect(h.swap).not.toHaveBeenCalled();expect(h.state.commit).not.toHaveBeenCalled()
})
it('fragment removed after selection cannot be collected from a detached node', async () => {
  const b=createBlock('html',{html:'<p>Original fragment</p>'});select(b);h.state.pickingId=b.id;await mount([b])
  const p=query('[data-testid="fragment-picker"] p');await click(p);p.remove();await click(query('[data-testid="pick-collect"]'))
  expect(h.fragment).not.toHaveBeenCalled();expect(h.collect).not.toHaveBeenCalled();expect(h.state.setPicking).not.toHaveBeenCalled()
})
async function dropRaw(target: Element, raw: string) {
  const e=new MouseEvent('drop',{bubbles:true,cancelable:true});Object.defineProperty(e,'dataTransfer',{value:{types:['application/x-xiumi-photo'],getData:()=>raw}});await event(target,e)
}
it.each([null, [], {}, {blockId:7,index:0}, {blockId:'source',index:-1}, {blockId:'source',index:.5}, {blockId:'source',index:9}, {blockId:'missing',index:0}])('invalid current photo position is ignored: %j',async payload=>{
  const a={...createBlock('html',{html:'<img src="https://example.test/a">'}),id:'source'},b=createBlock('html',{html:'<img src="https://example.test/b">'});await mount([a,b]);const target=Array.from(host.querySelectorAll('img'))[1];const errors:unknown[]=[];const listener=(e:ErrorEvent)=>{errors.push(e.error);e.preventDefault()};window.addEventListener('error',listener)
  try{await dropRaw(target,JSON.stringify(payload))}finally{window.removeEventListener('error',listener)}expect(errors).toEqual([]);expect(h.swap).not.toHaveBeenCalled();expect(h.state.commit).not.toHaveBeenCalled()
})
it('legitimate special-character IDs use exact dataset equality without selector interpolation',async()=>{
  const a={...createBlock('html',{html:'<img src="https://example.test/a">'}),id:'source"[\\:漢'},b=createBlock('html',{html:'<img src="https://example.test/b">'});await mount([a,b]);const target=Array.from(host.querySelectorAll('img'))[1];await dropRaw(target,JSON.stringify({blockId:a.id,index:0}));expect(h.swap).toHaveBeenCalledWith(h.state.doc,{blockId:a.id,index:0},{blockId:b.id,index:0},{ratioA:undefined,ratioB:undefined})
})
it('a drag started in an old document cannot affect a new document reusing its block IDs',async()=>{
  const a=createBlock('html',{html:'<img src="https://example.test/a">'}),b=createBlock('html',{html:'<img src="https://example.test/b">'});await mount([a,b]);const images=Array.from(host.querySelectorAll('img'));let raw='';const start=new MouseEvent('dragstart',{bubbles:true});Object.defineProperty(start,'dataTransfer',{value:{setData:(_k:string,v:string)=>{raw=v},effectAllowed:''}});await event(images[0],start)
  h.state.doc={...h.state.doc,id:'another-document'};await render();await dropRaw(images[1],raw);expect(h.swap).not.toHaveBeenCalled();expect(h.state.commit).not.toHaveBeenCalled()
})
it('a fragment moved to a different connected root cannot be collected',async()=>{
  const b=createBlock('html',{html:'<p>Move</p>'});select(b);h.state.pickingId=b.id;await mount([b]);const p=query('[data-testid="fragment-picker"] p');await click(p);const other=document.createElement('div');document.body.append(other);other.append(p)
  try{await click(query('[data-testid="pick-collect"]'));expect(h.collect).not.toHaveBeenCalled();expect(h.fragment).not.toHaveBeenCalled()}finally{other.remove()}
})
