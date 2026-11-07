// P0 兼容性探针：生成用于手动实测的样张，写到 data/compat-probe/（已被 .gitignore 排除）。
// 样张 01、02 只用项目原创内容；03、04、05、06 取自本机已导入的模板，属于用户的私有数据，不得提交或外传。
// 本脚本只读取模板和样例，只写 compat-probe 目录。实测结果由人工填写 docs/05-xiumi-compat-probe.md。
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import sharp from 'sharp'
import { createBlock } from '../src/core/blocks'
import { compileDoc } from '../src/core/compiler'
import { textToRich } from '../src/core/richtext'
import type { Block, Doc } from '../src/core/types'
import { DATA, DIRS, ROOT } from '../server/store'

const OUT = join(DATA, 'compat-probe')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const doc = (title: string, blocks: Block[]): Doc => ({ id: 'probe', title, author: '', digest: '', themeId: 'tsinghua-purple', blocks, createdAt: 0, updatedAt: 0 })

/** 每份样张两种形式：.html 可在浏览器打开后复制富文本，.fragment.txt 是纯 HTML 代码，用于粘贴到导入框 */
function write(name: string, title: string, note: string, body: string) {
  const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${title}</title></head>
<body style="margin:0;background:#f3f3f3"><p style="max-width:677px;margin:12px auto;font-size:13px;color:#666">${note}（全选复制时请只选下方白色区域）</p>
<div style="max-width:677px;margin:0 auto;background:#fff;padding:16px">${body}</div></body></html>`
  writeFileSync(join(OUT, `${name}.html`), page, 'utf8')
  writeFileSync(join(OUT, `${name}.fragment.txt`), body, 'utf8')
  console.log(`  ${name}  ${body.length.toLocaleString()} 字符`)
}

const textBlocks = (): Block[] => [
  createBlock('cover', { kicker: 'PROBE 01', title: '秀米导入探针：内置模块', subtitle: '检查这段文字能否在秀米里直接修改', meta: '只用于兼容性实测', variant: 'band' }),
  createBlock('heading', { index: '01', title: '章节标题能否单独选中', variant: 'number' }),
  createBlock('paragraph', { content: textToRich('这是正文段落。检查导入后段落能否修改，**加粗**是否保留，行距和字号是否与原样一致。') }),
  createBlock('card', { title: '卡片版块', content: textToRich('检查底色、边框和圆角是否保留，版块能否在秀米中整体拖动。'), variant: 'fill' }),
  createBlock('quote', { text: '引言版块：检查装饰样式是否保留。', source: '探针', variant: 'mark' }),
  createBlock('timeline', { items: [{ time: '09:00', title: '第一项', desc: '检查时间轴结构' }, { time: '10:00', title: '第二项', desc: '' }] }),
  createBlock('table', { headers: ['检查项', '记录'], rows: [['表格结构', '能否改单元格'], ['列宽', '是否错位']], caption: '表格版块' }),
  createBlock('divider', { variant: 'ornament' }),
  createBlock('ending', { text: '探针结束', note: '检查结尾署名样式', author: '探针生成，无真实署名' }),
]

const dataUri = async (file: string, w: number, h?: number) => {
  const buf = await sharp(join(ROOT, 'samples', file)).resize({ width: w, height: h, fit: 'cover' }).jpeg({ quality: 70 }).toBuffer()
  return `data:image/jpeg;base64,${buf.toString('base64')}`
}

console.log(`写入 ${OUT}`)
write('01-builtin-no-images', '探针 01 内置模块（无图片）', '不依赖任何图片，只看结构和可编辑性', compileDoc(doc('探针 01', textBlocks())).html)

const images: Block[] = [
  createBlock('image', { image: { src: await dataUri('photo-01.jpg', 640) }, caption: '单图：检查图片是否被秀米接收', variant: 'framed' }),
  createBlock('imageText', { image: { src: await dataUri('photo-02.jpg', 360) }, title: '图文分栏', content: textToRich('检查两栏是否错位，图片能否替换。'), imagePosition: 'left' }),
  createBlock('gallery', { images: [{ src: await dataUri('photo-03.jpg', 320) }, { src: await dataUri('photo-04.jpg', 320) }], columns: 2, caption: '双图相册' }),
]
write('02-builtin-data-images', '探针 02 内置模块（内嵌图片）', '图片是 base64 内嵌，检查秀米是否保留', compileDoc(doc('探针 02', images)).html)

// 取本机模板里的真实片段：一个较小的 SVG 片段（不含轮播）和一个含轮播背景图的片段
const parse = (s: string) => new JSDOM(s).window.document
const stat = (html: string) => {
  const d = parse(html).body
  return { svg: d.querySelectorAll('svg').length, animate: d.querySelectorAll('animate, animateTransform, animateMotion').length, bg: d.querySelectorAll('[style*="background-image"]').length }
}
const html: string[] = []
for (const f of readdirSync(DIRS.templates).filter((x) => x.endsWith('.json'))) {
  const t = JSON.parse(readFileSync(join(DIRS.templates, f), 'utf8'))
  for (const b of t.blocks ?? []) if (b.type === 'html') html.push(b.props.html)
}
const small = html.filter((h) => stat(h).svg > 0 && h.length < 20000).sort((a, b) => b.length - a.length)[0]
const carousel = html.filter((h) => stat(h).bg > 5 && stat(h).animate > 0).sort((a, b) => a.length - b.length)[0]
if (small) write('03-imported-svg-private', '探针 03 导入片段（SVG）', '私有数据，不要外传。检查 SVG 和文字是否可编辑', small)
else console.log('  03 跳过：本机模板里没有带 SVG 的导入片段')
if (carousel) write('04-imported-carousel-private', '探针 04 导入片段（轮播）', '私有数据，不要外传。检查轮播动效和背景图', carousel)
else console.log('  04 跳过：本机模板里没有带动效和背景图的导入片段')

// 背景图在公众号后台的保留情况：微信图床（对照组）、内嵌图片、普通 https 外链
const mmbiz = html.flatMap((h) => [...h.matchAll(/https:\/\/mmbiz\.qpic\.cn\/sz_mmbiz_jpg\/[^"'&)\s]+(?:\?wx_fmt=jpe?g)?/gi)].map((m) => m[0]))[0]
const panel = (label: string, url: string) =>
  `<section style="margin: 0 0 14px"><p style="margin: 0 0 6px; font-size: 14px; color: #333333">${label}</p><section style="width: 100%; height: 180px; background-color: #eeeeee; background-size: cover; background-position: center; background-image: url(&quot;${url}&quot;)"></section></section>`
const panels = [
  mmbiz ? panel('A 微信图床背景（对照组，应当显示）', mmbiz) : '',
  panel('B 内嵌图片背景（data URI）', await dataUri('photo-05.jpg', 480, 240)),
  panel('C 普通 https 外链背景（请把地址换成你能访问的公开图片）', 'https://example.com/PUBLIC_IMAGE.jpg'),
].join('')
write('05-background-paste-test', '探针 05 背景图粘贴', '在浏览器打开，复制白色区域，粘贴到公众号后台，查看 A、B、C 三块是否还有图', `<section>${panels}</section>`)

// 图片矩阵：每行一种来源和格式，导入秀米后看哪几行变成占位图，就知道它拒绝的是哪一类
const wxImage = (dir: string) => html.flatMap((h) => [...h.matchAll(new RegExp(`https://mmbiz\\.qpic\\.cn/${dir}/[^"'&)\\s]+`, 'gi'))].map((m) => m[0]))[0]
const toData = (mime: string, buf: Buffer) => `data:${mime};base64,${buf.toString('base64')}`
const kb = (n: number) => `${Math.round(n / 1024)}KB`
const sample = sharp(join(ROOT, 'samples', 'photo-06.jpg')).resize({ width: 480 })
const smallJpg = await sample.clone().jpeg({ quality: 70 }).toBuffer()
const smallPng = await sample.clone().resize({ width: 240 }).ensureAlpha(0.8).png().toBuffer()
const smallGif = await sample.clone().resize({ width: 160 }).gif().toBuffer()
const bigJpg = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#888888', noise: { type: 'gaussian', mean: 128, sigma: 45 } } }).jpeg({ quality: 92 }).toBuffer()
const row = (label: string, content: string) => `<section style="margin: 0 0 18px"><p style="margin: 0 0 6px; font-size: 14px; color: #333333"><strong>${label}</strong></p>${content}</section>`
const img = (src: string) => `<img src="${src}" style="width: 100%; display: block">`
const bgBox = (url: string) => `<section style="width: 100%; height: 180px; background-color: #eeeeee; background-size: cover; background-position: center; background-image: url(&quot;${url}&quot;)"></section>`
const bgSvg = (url: string) => `<svg viewBox="0 0 1080 720" style="display: block; width: 100%; background-size: 100%; background-image: url(&quot;${url}&quot;)"></svg>`
const smallData = toData('image/jpeg', smallJpg)
const wxJpg = wxImage('sz_mmbiz_jpg')
const wxPng = wxImage('sz_mmbiz_png')
const wxGif = wxImage('sz_mmbiz_gif')
const matrix = [
  row(`A 内嵌 JPG（${kb(smallJpg.length)}）`, img(smallData)),
  row(`C 内嵌透明 PNG（${kb(smallPng.length)}）`, img(toData('image/png', smallPng))),
  row(`D 内嵌 GIF（${kb(smallGif.length)}）`, img(toData('image/gif', smallGif))),
  wxJpg ? row('E 微信图床 JPG', img(`${wxJpg}?wx_fmt=jpeg`)) : '',
  wxPng ? row('F 微信图床 PNG', img(`${wxPng}?wx_fmt=png`)) : '',
  wxGif ? row('G 微信图床 GIF', img(`${wxGif}?wx_fmt=gif`)) : '',
  row('H 普通外链（百度 logo）', img('https://www.baidu.com/img/flexible/logo/pc/result.png')),
  row('I 背景图：内嵌 JPG', bgBox(smallData)),
  wxJpg ? row('J 背景图：微信图床 JPG', bgBox(`${wxJpg}?wx_fmt=jpeg`)) : '',
  row('K SVG 背景图：内嵌 JPG（轮播写法）', bgSvg(smallData)),
  wxJpg ? row('L SVG 背景图：微信图床 JPG（轮播写法）', bgSvg(`${wxJpg}?wx_fmt=jpeg`)) : '',
].join('')
write('06-image-matrix-private', '探针 06 图片矩阵', '私有数据，不要外传。导入秀米后记录哪几行变成占位图', `<section>${matrix}</section>`)
// 大图单独一份：如果秀米限制总大小，不会连累上面的矩阵
write('07-large-image', '探针 07 大图', '检查内嵌大图是否被接受', `<section>${row(`B 内嵌大 JPG（${kb(bigJpg.length)}）`, img(toData('image/jpeg', bigJpg)))}</section>`)
console.log('完成。按 docs/05-xiumi-compat-probe.md 的步骤实测；03、04、05、06 不要提交或发给他人。')
