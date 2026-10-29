import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { blockPhotos, fitRatio, replacePhoto, swapPhotos } from '../../src/core/photos'
import type { Block, Doc } from '../../src/core/types'

const parse = (s: string) => new JSDOM(s).window.document
const doc = (blocks: Block[]): Doc => ({ id: 'd', title: 't', author: '', digest: '', themeId: 'x', blocks, createdAt: 0, updatedAt: 0 })
const htmlOf = (b: Block) => (b.type === 'html' ? b.props.html : '')

// 原文片段：一张已按 4:3 相框裁切的照片 + 一个图标；内置相册两张照片
const frag = { id: 'h', type: 'html' as const, props: { label: '片段', html: '<section style="border: 2px solid green"><img src="/media/a.jpg?fit=100%3A75&amp;w=1080" style="width: 100%"><img src="https://mmbiz.qpic.cn/icon/0?wx_fmt=png" style="width: 20px"></section>' } }
const gallery = { ...createBlock('gallery', { images: [{ src: '/media/b.jpg', width: 800, height: 600 }, { src: '/media/c.jpg' }] }), id: 'g' }

describe('photo positions', () => {
  it('lists movable photos in render order; decorations and QR codes are fixed', () => {
    expect(blockPhotos(frag, parse)).toEqual([{ src: '/media/a.jpg?fit=100%3A75&w=1080' }, null])
    expect(blockPhotos(gallery, parse).map((p) => p?.src)).toEqual(['/media/b.jpg', '/media/c.jpg'])
    expect(blockPhotos(createBlock('ending', { image: { src: '/media/qr.jpg' } }), parse)).toEqual([null])
    expect(fitRatio('/media/a.jpg?fit=100%3A75&w=1080')).toBe(0.75)
  })
  it('swaps photos between a template frame and a gallery, cropping each to its new place', () => {
    const next = swapPhotos(doc([frag, gallery]), { blockId: 'h', index: 0 }, { blockId: 'g', index: 1 }, { parse })
    expect(htmlOf(next.blocks[0])).toContain('src="/media/c.jpg?fit=100%3A75&amp;w=1080"')
    expect(htmlOf(next.blocks[0])).toContain('wx_fmt=png') // 图标不动
    expect((next.blocks[1] as Block<'gallery'>).props.images.map((i) => i.src)).toEqual(['/media/b.jpg', '/media/a.jpg'])
  })
  it('swaps within one block and ignores decorations', () => {
    const d = doc([gallery, frag])
    const next = swapPhotos(d, { blockId: 'g', index: 0 }, { blockId: 'g', index: 1 }, { parse })
    expect((next.blocks[0] as Block<'gallery'>).props.images.map((i) => i.src)).toEqual(['/media/c.jpg', '/media/b.jpg'])
    expect(swapPhotos(d, { blockId: 'g', index: 0 }, { blockId: 'h', index: 1 }, { parse })).toBe(d)
  })
  it('replaces a template photo using the shown frame ratio', () => {
    const tpl = { ...frag, props: { ...frag.props, html: '<p><img src="https://mmbiz.qpic.cn/old/640?wx_fmt=jpeg" style="width: 100%"></p>' } }
    const next = replacePhoto(doc([tpl]), { blockId: 'h', index: 0 }, { src: '/media/new.jpg' }, { ratio: 0.5, parse })
    expect(htmlOf(next.blocks[0])).toContain('src="/media/new.jpg?fit=100%3A50&amp;w=1080"')
  })
})
