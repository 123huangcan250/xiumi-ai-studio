/* global console */
// 生成「清华电机系赴德国海外社会实践支队」公众号模板库（单文件 HTML）。
// 运行：node build.mjs  →  eea-germany-template.html
// 复制进公众号的模块只用行内样式；SVG 不使用 id 引用（渐变/图案/裁剪），网格与刻度都逐线绘制。
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'eea-germany-template.html')

const C = {
  purple: '#660874', blue: '#1E3A8A', bg: '#F8F7FA', white: '#FFFFFF',
  black: '#18181B', red: '#D90429', gold: '#F59E0B', lilac: '#C4B5FD', gray: '#888888',
}
const MONO = 'Menlo, Consolas, Courier New, monospace'
const MONO_CSS = "Menlo,Consolas,'Courier New',monospace"
const NUM_CSS = "'DIN Alternate','Bahnschrift','Helvetica Neue',Arial,sans-serif"
const SANS = 'PingFang SC, Microsoft YaHei, Helvetica Neue, Arial, sans-serif'

const f = (n) => Math.round(n * 100) / 100
const rad = (d) => (d * Math.PI) / 180
const pt = (cx, cy, r, deg) => [f(cx + r * Math.cos(rad(deg))), f(cy + r * Math.sin(rad(deg)))]
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ---------- SVG 基础件 ----------
const svg = (w, h, body, style = '') =>
  `<svg viewBox="0 0 ${w} ${h}" width="100%" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;overflow:hidden;${style}">${body}</svg>`
const icon = (w, h, body, style = '') =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" style="display:block;flex-shrink:0;width:${w}px;height:${h}px;overflow:hidden;${style}">${body}</svg>`
const t = (x, y, size, txt, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-family="${o.ff ?? MONO}" fill="${o.fill ?? C.purple}"` +
  (o.anchor ? ` text-anchor="${o.anchor}"` : '') + (o.op != null ? ` opacity="${o.op}"` : '') +
  (o.ls != null ? ` letter-spacing="${o.ls}"` : '') + (o.fw ? ` font-weight="${o.fw}"` : '') +
  (o.tr ? ` transform="${o.tr}"` : '') + `>${esc(txt)}</text>`
const ln = (x1, y1, x2, y2, o = {}) =>
  `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${o.c ?? C.purple}" stroke-width="${o.w ?? 0.6}"` +
  (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + (o.op != null ? ` opacity="${o.op}"` : '') + (o.cap ? ` stroke-linecap="${o.cap}"` : '') + '/>'
const path = (d, o = {}) =>
  `<path d="${d}" fill="${o.fill ?? 'none'}" stroke="${o.c ?? C.purple}" stroke-width="${o.w ?? 0.6}"` +
  (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + (o.op != null ? ` opacity="${o.op}"` : '') +
  (o.fo != null ? ` fill-opacity="${o.fo}"` : '') + (o.join ? ` stroke-linejoin="${o.join}"` : '') + (o.cap ? ` stroke-linecap="${o.cap}"` : '') + (o.extra ?? '') + '/>'
const circ = (cx, cy, r, o = {}) =>
  `<circle cx="${f(cx)}" cy="${f(cy)}" r="${r}" fill="${o.fill ?? 'none'}"` + (o.c ? ` stroke="${o.c}" stroke-width="${o.w ?? 0.6}"` : '') +
  (o.op != null ? ` opacity="${o.op}"` : '') + (o.dash ? ` stroke-dasharray="${o.dash}"` : '') + '>' + (o.inner ?? '') + '</circle>'
const rect = (x, y, w, h, o = {}) =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${o.fill ?? 'none'}"` + (o.c ? ` stroke="${o.c}" stroke-width="${o.w ?? 0.6}"` : '') +
  (o.op != null ? ` opacity="${o.op}"` : '') + (o.fo != null ? ` fill-opacity="${o.fo}"` : '') + (o.rx ? ` rx="${o.rx}"` : '') + '/>'
/** 刻度：用描边宽度当刻度长度、虚线当间距，一条线画出一排刻度（不依赖 pattern/id） */
const ticks = (x1, x2, y, len, step, o = {}) =>
  `<line x1="${f(x1)}" y1="${f(y)}" x2="${f(x2)}" y2="${f(y)}" stroke="${o.c ?? C.purple}" stroke-width="${len}" stroke-dasharray="${o.w ?? 0.5} ${f(step - (o.w ?? 0.5))}" opacity="${o.op ?? 0.4}"/>`
const vticks = (x, y1, y2, len, step, o = {}) =>
  `<line x1="${f(x)}" y1="${f(y1)}" x2="${f(x)}" y2="${f(y2)}" stroke="${o.c ?? C.purple}" stroke-width="${len}" stroke-dasharray="${o.w ?? 0.5} ${f(step - (o.w ?? 0.5))}" opacity="${o.op ?? 0.4}"/>`
/** 正弦波折线；ampFn 可让振幅随 x 变化（脉冲包络） */
function wave(x0, x1, cy, amp, period, phase = 0, step = 1.2, ampFn) {
  let d = ''
  for (let x = x0; x <= x1 + 1e-6; x += step) {
    const a = ampFn ? ampFn(x) : amp
    d += (d ? 'L' : 'M') + f(x) + ' ' + f(cy - a * Math.sin((2 * Math.PI * (x - x0)) / period + rad(phase)))
  }
  return d
}
function gear(cx, cy, ro, ri, n) {
  const step = 360 / n
  let d = ''
  for (let i = 0; i < n; i++) {
    const a = i * step - 90
    for (const [r, da] of [[ri, -0.32], [ro, -0.17], [ro, 0.17], [ri, 0.32]]) {
      const [x, y] = pt(cx, cy, r, a + da * step)
      d += (d ? 'L' : 'M') + x + ' ' + y
    }
  }
  return d + 'Z'
}
const diamond = (x, y, s, fill) => `<path d="M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z" fill="${fill}"/>`
/** 粗连杆（机械臂） */
function limb(x1, y1, x2, y2, w) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy), nx = (-dy / L) * w, ny = (dx / L) * w
  return `M${f(x1 + nx)} ${f(y1 + ny)}L${f(x2 + nx)} ${f(y2 + ny)}L${f(x2 - nx)} ${f(y2 - ny)}L${f(x1 - nx)} ${f(y1 - ny)}Z`
}
function arrow(cx, cy, len, deg, color, w = 1) {
  const [x, y] = pt(cx, cy, len, deg)
  const [a1, b1] = pt(x, y, 3.2, deg + 155)
  const [a2, b2] = pt(x, y, 3.2, deg - 155)
  return ln(cx, cy, x, y, { c: color, w }) + `<path d="M${x} ${y}L${a1} ${b1}L${a2} ${b2}Z" fill="${color}"/>`
}
const spin = (cx, cy, dur, dir = 1) =>
  `<animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="${360 * dir} ${cx} ${cy}" dur="${dur}s" repeatCount="indefinite"/>`
const blink = (dur = 1.6) => `<animate attributeName="opacity" values="1;0.25;1" dur="${dur}s" repeatCount="indefinite"/>`

// ---------- HTML 基础件 ----------
const P = 'margin:0 0 16px;font-size:14px;color:#000000;line-height:1.85;letter-spacing:0.8px;text-align:justify;'
const CAP = 'margin:0;font-size:12px;color:#888888;line-height:1.5;letter-spacing:0.3px;text-align:left;'
const U = (id, w, h) => `https://images.unsplash.com/photo-${id}?auto=format&amp;fit=crop&amp;w=${w}&amp;h=${h}&amp;q=80`
const IMG = (id, w, h, alt) =>
  `<img src="${U(id, w, h)}" alt="${alt}" style="display:block;width:100%;height:auto;margin:0;padding:0;border:0">`
const CAM = icon(14, 14,
  rect(1.5, 4, 11, 8, { c: C.purple, w: 1, rx: 1.5 }) + path('M4.5 4L5.5 2.2H8.5L9.5 4', { w: 1 }) +
  circ(7, 8, 2.2, { c: C.purple, w: 1 }) + circ(11, 5.6, 0.6, { fill: C.red }), 'margin:2px 6px 0 0')
const NODE = icon(14, 14,
  ln(0, 7, 4.5, 7, { w: 1 }) + ln(9.5, 7, 14, 7, { w: 1 }) + circ(7, 7, 2.5, { c: C.purple, w: 1, fill: C.white }) +
  circ(7, 7, 1, { fill: C.gold }) + ln(7, 0, 7, 4.5, { w: 1, op: 0.5 }), 'margin:2px 6px 0 0')
const DWG = icon(14, 14,
  rect(1.5, 1.5, 11, 11, { c: C.purple, w: 1 }) + ln(1.5, 9, 12.5, 9, { w: 0.8 }) + ln(7, 9, 7, 12.5, { w: 0.8 }) +
  path('M3.5 7L6 4L8 6L10.5 3.5', { w: 0.9, c: C.blue }), 'margin:2px 6px 0 0')
/** 图注槽位：删空文字后图标仍撑住固定高度，边框不会塌 */
const capRow = (text, ic = CAM) =>
  `<section style="display:flex;align-items:flex-start;margin:0;padding:7px 2px 0;min-height:27px;box-sizing:border-box">${ic}<p style="${CAP}flex:1;min-width:0">${text}</p></section>`
/** 角标：跟在图片后、用负外边距压到图片左下角（不用绝对定位） */
const badge = (n) =>
  `<section style="margin:-20px 0 0;height:20px;line-height:0;text-align:left"><span style="display:inline-block;height:20px;line-height:20px;padding:0 7px;background-color:#660874;color:#FFFFFF;font-size:10px;font-weight:700;font-family:${MONO_CSS};letter-spacing:1px;vertical-align:top">${n}</span><span style="display:inline-block;width:3px;height:20px;background-color:#F59E0B;vertical-align:top"></span></section>`
/** 栏内小标签条 */
const colTag = (label, right = '') =>
  svg(175, 12,
    rect(0, 0, 40, 9, { fill: C.purple }) + t(20, 6.6, 5.4, label, { fill: C.white, anchor: 'middle', ls: 0.6, fw: 700 }) +
    ln(40, 8.6, 175, 8.6, { op: 0.35 }) + ticks(46, 150, 6.2, 3, 5, { op: 0.35 }) +
    (right ? t(174, 5.6, 4.8, right, { anchor: 'end', op: 0.6 }) : rect(168, 4.5, 7, 3, { fill: C.gold })), 'margin:0 0 3px')

// ============ 1. 刊头 ============
function headerArt() {
  const W = 360, H = 250, G = 206
  const WH = '#FFFFFF'
  let s = ''
  // 光晕：同心圆叠加近似径向渐变
  for (const [r, o] of [[160, 0.025], [118, 0.03], [84, 0.04], [54, 0.05], [30, 0.05]]) s += circ(184, 92, r, { fill: WH, op: o })
  s += circ(300, 86, 60, { fill: C.gold, op: 0.05 }) + circ(300, 86, 34, { fill: C.gold, op: 0.05 })
  // 示波器网格（虚线技巧画整片网格）
  s += `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="${WH}" stroke-width="${H}" stroke-dasharray="0.35 19.65" opacity="0.07"/>`
  s += `<line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" stroke="${WH}" stroke-width="${W}" stroke-dasharray="0.35 19.65" opacity="0.07"/>`
  // 极坐标
  const pc = [184, 46]
  for (const [r, dash] of [[34, ''], [58, '2 3'], [86, ''], [118, '2 3'], [152, ''], [190, '1 4']]) s += circ(pc[0], pc[1], r, { c: WH, w: 0.45, op: 0.11, dash })
  let rays = ''
  for (let a = 0; a < 360; a += 15) {
    const [x1, y1] = pt(pc[0], pc[1], 30, a), [x2, y2] = pt(pc[0], pc[1], 200, a)
    rays += `M${x1} ${y1}L${x2} ${y2}`
  }
  s += path(rays, { c: WH, w: 0.35, op: 0.06 })
  let bezel = ''
  for (let a = 0; a < 360; a += 5) {
    const [x1, y1] = pt(pc[0], pc[1], a % 30 ? 25.5 : 24, a), [x2, y2] = pt(pc[0], pc[1], 27.5, a)
    bezel += `M${x1} ${y1}L${x2} ${y2}`
  }
  s += path(bezel, { c: WH, w: 0.45, op: 0.55 })
  s += ln(0, pc[1], W, pc[1], { c: WH, w: 0.4, op: 0.12 }) + ln(pc[0], 0, pc[0], G, { c: WH, w: 0.4, op: 0.12 })
  s += ticks(0, W, pc[1], 2.4, 4, { c: WH, op: 0.22, w: 0.35 }) + vticks(pc[0], 0, G, 2.4, 4, { c: WH, op: 0.22, w: 0.35 })
  // 相量图：三相旋转矢量
  s += circ(pc[0], pc[1], 21, { c: WH, w: 0.7, op: 0.8 }) + circ(pc[0], pc[1], 21, { fill: WH, op: 0.06 })
  s += `<g>${arrow(pc[0], pc[1], 19, -90, WH, 1.1)}${arrow(pc[0], pc[1], 19, 30, C.lilac, 1.1)}${arrow(pc[0], pc[1], 19, 150, C.gold, 1.1)}${spin(pc[0], pc[1], 8)}</g>`
  s += circ(pc[0], pc[1], 1.8, { fill: WH })
  s += t(pc[0], pc[1] + 37, 5, 'PHASOR · L1 L2 L3 · 120°', { fill: WH, anchor: 'middle', op: 0.7, ls: 0.4 })

  // 左：高压输电铁塔
  const leg = (y) => { const k = (G - y) / (G - 44); return [12 + 12 * k, 44 - 12 * k] }
  let tw = `M12 ${G}L24 44M44 ${G}L32 44M24 44L28 32L32 44`
  const lv = [G, 182, 160, 140, 122, 106, 92, 80, 70, 62, 54, 44]
  for (let i = 0; i < lv.length - 1; i++) {
    const [l0, r0] = leg(lv[i]), [l1, r1] = leg(lv[i + 1])
    tw += `M${f(l0)} ${lv[i]}L${f(r1)} ${lv[i + 1]}M${f(r0)} ${lv[i]}L${f(l1)} ${lv[i + 1]}M${f(l1)} ${lv[i + 1]}L${f(r1)} ${lv[i + 1]}`
  }
  for (const [y, a, b] of [[62, 4, 52], [80, 8, 48]]) {
    const [l, r] = leg(y + 9)
    tw += `M${a} ${y}L${b} ${y}M${a} ${y}L${f(l)} ${y + 9}M${b} ${y}L${f(r)} ${y + 9}M${a} ${y}L${a} ${y + 7}M${b} ${y}L${b} ${y + 7}`
  }
  s += path(tw, { c: WH, w: 0.55, op: 0.6 })
  for (const [x, y] of [[4, 69], [52, 69], [8, 87], [48, 87]]) s += circ(x, y, 0.9, { fill: WH, op: 0.8 })
  s += t(56, 40, 5.5, '400 kV', { fill: C.gold, op: 0.95, fw: 700 })
  // 输电线 → 变压器
  s += path('M52 69Q88 86 116 89M48 87Q86 98 116 94M4 69Q-2 70 -6 72M8 87Q0 88 -6 90', { c: WH, w: 0.5, op: 0.55 })
  s += path('M28 32Q80 46 126 80', { c: WH, w: 0.4, op: 0.35, dash: '1.5 2' })
  s += circ(119, 91.5, 5.6, { c: WH, w: 0.8 }) + circ(127, 91.5, 5.6, { c: WH, w: 0.8 })
  s += t(123, 104, 4.4, 'Δ/Y', { fill: WH, anchor: 'middle', op: 0.75 })

  // 左：二校门几何线稿
  let gate = ''
  gate += rect(58, 200, 68, 6, { c: WH, w: 0.6, fill: WH, fo: 0.05 })
  gate += path('M62 200V144H122V200', { c: WH, w: 0.8, fill: WH, fo: 0.07 })
  gate += path('M82 200V166A10 10 0 0 1 102 166V200', { c: WH, w: 0.8, fill: '#2A0B45', fo: 0.35 })
  gate += path('M78 200V166A14 14 0 0 1 106 166', { c: WH, w: 0.4, op: 0.5 })
  for (const x of [65, 71, 110, 116]) gate += rect(x, 150, 3, 50, { c: WH, w: 0.5, fill: WH, fo: 0.12 }) + rect(x - 0.8, 148, 4.6, 2, { fill: WH, op: 0.7 })
  gate += path('M58 136H126M60 140H124M60 144H124', { c: WH, w: 0.6, op: 0.8 })
  gate += ticks(61, 123, 138, 3, 3, { c: WH, op: 0.35, w: 0.6 })
  gate += path('M70 136V122H114V136', { c: WH, w: 0.7, fill: WH, fo: 0.06 })
  gate += rect(79, 124.5, 26, 9, { c: WH, w: 0.5, fill: WH, fo: 0.14 })
  gate += t(92, 131.4, 5.6, '清华园', { fill: WH, anchor: 'middle', ff: SANS, fw: 700, ls: 1 })
  gate += path('M84 122V116Q92 107 100 116V122', { c: WH, w: 0.7, fill: WH, fo: 0.08 })
  gate += circ(92, 115, 1.2, { fill: C.gold })
  for (const y of [160, 170, 180, 190]) gate += path(`M62 ${y}H64M75 ${y}H82M102 ${y}H109M120 ${y}H122`, { c: WH, w: 0.4, op: 0.35 })
  s += gate
  s += t(92, 217, 5, 'TSINGHUA · EST. 1911', { fill: WH, anchor: 'middle', op: 0.75, ls: 0.5 })

  // 中：三相正弦波 + 能量脉冲
  const phases = [[0, WH], [-120, C.lilac], [120, C.gold]]
  for (const [ph, col] of phases) s += path(wave(134, 240, 100, 12, 48, ph), { c: col, w: 1, op: 0.92 })
  s += `<path d="${wave(134, 240, 100, 12, 48, 0)}" fill="none" stroke="${WH}" stroke-width="2" stroke-dasharray="2 22" stroke-linecap="round" opacity="0.9"><animate attributeName="stroke-dashoffset" from="0" to="-48" dur="1.6s" repeatCount="indefinite"/></path>`
  for (const [ph, col] of phases) {
    const y = 100 - 12 * Math.sin((2 * Math.PI * 106) / 48 + rad(ph))
    s += circ(240, y, 1.6, { fill: '#2A0B45', c: col, w: 0.8 })
  }
  s += t(140, 124, 5.2, '∿ 50 Hz · 3φ AC', { fill: WH, op: 0.75, ls: 0.4 })
  // 中：PCB 走线
  s += path('M126 197H146L152 191H163M165 191H178L184 197H202', { c: C.lilac, w: 0.7, op: 0.7 })
  s += path('M126 193H140L148 185H160l1.5 -2.5l2 5l2 -5l2 5l2 -5l2 5l1.5 -2.5H190L196 191H202', { c: C.lilac, w: 0.7, op: 0.7, join: 'round' })
  s += ln(163, 187.5, 163, 194.5, { c: C.lilac, w: 0.9, op: 0.8 }) + ln(165, 187.5, 165, 194.5, { c: C.lilac, w: 0.9, op: 0.8 })
  for (const [x, y] of [[146, 197], [152, 191], [178, 191], [140, 193], [148, 185], [190, 185], [196, 191]]) s += circ(x, y, 1.3, { c: C.lilac, w: 0.6, fill: '#2A0B45' })
  s += t(166, 180, 4.2, 'PCB · R1 C1', { fill: C.lilac, anchor: 'middle', op: 0.8 })

  // 中右：工业机器人手臂（够向能量波）
  let robot = rect(202, 200, 24, 6, { c: WH, w: 0.7, fill: WH, fo: 0.12 }) + rect(206, 194, 16, 6, { c: WH, w: 0.7, fill: WH, fo: 0.1 })
  robot += path(limb(214, 188, 232, 152, 3.2), { c: WH, w: 0.7, fill: WH, fo: 0.14 })
  robot += path(limb(232, 152, 212, 126, 2.4), { c: WH, w: 0.7, fill: WH, fo: 0.14 })
  robot += circ(214, 188, 5, { c: WH, w: 0.8, fill: '#2A0B45' }) + circ(214, 188, 1.6, { fill: C.gold })
  robot += circ(232, 152, 4, { c: WH, w: 0.8, fill: '#2A0B45' }) + circ(232, 152, 1.2, { fill: WH })
  robot += circ(212, 126, 2.8, { c: WH, w: 0.8, fill: '#2A0B45' })
  {
    const L = Math.hypot(-20, -26), dx = -20 / L, dy = -26 / L, px = -dy, py = dx
    for (const sgn of [1, -1]) {
      const bx = 212 + dx * 2.8 + px * 2.2 * sgn, by = 126 + dy * 2.8 + py * 2.2 * sgn
      robot += ln(bx, by, bx + dx * 6, by + dy * 6, { c: WH, w: 1, cap: 'round' })
    }
  }
  robot += path('M226 160A10 10 0 0 1 236 146', { c: C.gold, w: 0.5, dash: '1 1.5', op: 0.8 })
  s += robot + t(214, 217, 4.4, '6-AXIS', { fill: WH, anchor: 'middle', op: 0.6 })

  // 右：风力发电机（叶片旋转）
  s += path('M346 206L346.6 64M350 206L348.4 64', { c: WH, w: 0.6, op: 0.75 })
  s += rect(343.5, 59.5, 8, 4.5, { c: WH, w: 0.6, fill: WH, fo: 0.2, rx: 1 })
  const hub = [347.5, 61.5]
  const blade = `M${hub[0]} ${hub[1]}L${hub[0] - 2.4} ${hub[1] - 8}L${hub[0] - 0.6} ${hub[1] - 36}L${hub[0] + 1} ${hub[1] - 8}Z`
  s += `<g>${[0, 120, 240].map((a) => `<path d="${blade}" fill="${WH}" fill-opacity="0.22" stroke="${WH}" stroke-width="0.6" transform="rotate(${a} ${hub[0]} ${hub[1]})"/>`).join('')}${spin(hub[0], hub[1], 7)}</g>`
  s += circ(hub[0], hub[1], 1.8, { fill: C.gold })

  // 右：勃兰登堡门
  let bt = rect(246, 200, 88, 6, { c: WH, w: 0.6, fill: WH, fo: 0.06 }) + path('M246 202H334M246 204H334', { c: WH, w: 0.35, op: 0.5 })
  for (const x of [240, 330]) {
    bt += rect(x, 170, 10, 30, { c: WH, w: 0.6, fill: WH, fo: 0.08 }) + path(`M${x - 2} 168H${x + 12}M${x - 1} 170H${x + 11}`, { c: WH, w: 0.6, op: 0.8 })
    bt += path(`M${x + 3} 172V200M${x + 7} 172V200`, { c: WH, w: 0.5, op: 0.6 })
  }
  for (const x of [252, 265.31, 278.62, 297.76, 311.07, 324.38]) {
    bt += rect(x, 158, 3.6, 42, { c: WH, w: 0.55, fill: WH, fo: 0.16 }) + ln(x + 1.8, 160, x + 1.8, 198, { c: WH, w: 0.3, op: 0.5 })
    bt += rect(x - 1, 155.5, 5.6, 2.5, { fill: WH, op: 0.75 })
  }
  bt += rect(249, 146, 82, 9.5, { c: WH, w: 0.7, fill: WH, fo: 0.1 }) + ticks(250, 330, 150.7, 5, 3.4, { c: WH, op: 0.45, w: 1 })
  bt += rect(256, 134, 68, 12, { c: WH, w: 0.7, fill: WH, fo: 0.08 }) + rect(266, 137, 48, 6, { c: WH, w: 0.4, op: 0.6 })
  bt += rect(276, 127, 28, 7, { c: WH, w: 0.7, fill: WH, fo: 0.12 })
  // 四马战车
  let q = rect(284, 120, 12, 5, { c: WH, w: 0.6, fill: WH, fo: 0.25 })
  for (const x of [279, 284.5, 292.5, 298]) q += path(`M${x} 127V118Q${x + 1.6} 112.5 ${x + 3.2} 115.5`, { c: WH, w: 0.8, cap: 'round' })
  q += ln(290, 108, 290, 120, { c: WH, w: 0.9 }) + circ(290, 106.4, 1.4, { fill: WH }) + ln(290, 111, 293.5, 109.5, { c: WH, w: 0.7 })
  q += ln(293.5, 122, 293.5, 99, { c: WH, w: 0.6 }) + circ(293.5, 96.6, 2.4, { c: C.gold, w: 0.7 }) + path('M292.3 96.6H294.7M293.5 95.4V97.8', { c: C.gold, w: 0.6 })
  s += bt + q
  s += t(290, 217, 5, 'BRANDENBURGER TOR · 1791', { fill: WH, anchor: 'middle', op: 0.75, ls: 0.4 })

  // 地面、坐标、角标
  s += ln(0, G, W, G, { c: WH, w: 0.6, op: 0.55 }) + ticks(0, W, 209, 4, 4, { c: WH, op: 0.22, w: 0.4 })
  s += t(10, 236, 6, "40°00'N 116°19'E · BEIJING", { fill: WH, op: 0.9, ls: 0.3 })
  s += t(350, 236, 6, "BERLIN · 52°30'N 13°22'E", { fill: WH, op: 0.9, ls: 0.3, anchor: 'end' })
  s += ln(128, 234, 232, 234, { c: WH, w: 0.5, op: 0.45, dash: '2 2' })
  s += path('M174 234H187M182 234L178 229.5M182 234L178 238.5M175.5 234L174 231.5M175.5 234L174 236.5', { c: C.gold, w: 0.9, cap: 'round' })
  s += t(10, 14, 5.6, 'FIG.01 — ENERGY BRIDGE', { fill: WH, op: 0.8, ls: 0.6 })
  s += t(350, 14, 5.6, 'SCALE 1:∞ · REV.A', { fill: WH, op: 0.8, ls: 0.6, anchor: 'end' })
  s += path('M4 12V4H12M348 4H356V12M4 238V246H12M348 246H356V238', { c: WH, w: 0.8, op: 0.7 })
  return svg(W, H, s)
}

function moduleHeader() {
  const top = svg(360, 26,
    t(0, 11, 7.2, 'TSINGHUA EEA OVERSEAS PRACTICE // GERMANY', { fw: 700, ls: 0.7 }) +
    circ(316, 8.6, 1.7, { fill: C.red, inner: blink() }) + t(360, 11, 7.2, 'VOL.2026', { fill: C.blue, anchor: 'end', fw: 700, ls: 0.6 }) +
    ln(0, 19, 282, 19, { op: 0.55, w: 0.6 }) + ticks(0, 282, 22, 2, 6, { op: 0.35 }) +
    rect(288, 17.5, 24, 3, { fill: C.black }) + rect(312, 17.5, 24, 3, { fill: C.red }) + rect(336, 17.5, 24, 3, { fill: C.gold }), 'margin:0 0 6px')
  const lights = icon(30, 8, circ(4, 4, 3, { fill: C.black }) + circ(15, 4, 3, { fill: C.red }) + circ(26, 4, 3, { fill: C.gold }), 'margin:0 8px 0 0')
  const ruler = svg(360, 12, ln(0, 1, 360, 1, { op: 0.3 }) + ticks(0, 360, 4, 6, 6, { op: 0.35 }) + ticks(0, 360, 5, 8, 30, { op: 0.6, w: 0.7 }) +
    t(360, 11.5, 4.6, 'EEA-DE-2026 · HEADER', { anchor: 'end', op: 0.6 }), 'margin:14px 0 0')
  return `<section style="margin:0 0 28px;padding:0;box-sizing:border-box">${top}` +
    `<section style="background-color:#45197F;background-image:linear-gradient(120deg,#660874 0%,#3E2080 55%,#1E3A8A 100%);line-height:0;padding:0">${headerArt()}</section>` +
    `<section style="padding:16px 2px 0">` +
    `<section style="display:flex;align-items:center;margin:0 0 8px">${lights}<p style="margin:0;font-size:11px;line-height:1.4;color:#1E3A8A;letter-spacing:2px;font-family:${MONO_CSS};font-weight:700">VOL.2026 · EEA × GERMANY</p></section>` +
    `<p style="margin:0;font-size:20px;line-height:1.5;font-weight:700;color:#18181B;letter-spacing:1px">从二校门到勃兰登堡门</p>` +
    `<p style="margin:2px 0 0;font-size:15px;line-height:1.6;font-weight:700;color:#660874;letter-spacing:1px">一场跨越欧亚的能源对话</p>` +
    `<p style="margin:8px 0 0;font-size:12px;line-height:1.5;color:#888888;letter-spacing:0.5px">清华大学电机工程与应用电子技术系 · 赴德国海外社会实践支队</p>` +
    `</section>${ruler}</section>`
}

// ============ 2. 标题与分割线 ============
function gauge() {
  let s = ''
  const c = [25, 26]
  let tk = ''
  for (let a = 190; a <= 350; a += 10) {
    const [x1, y1] = pt(c[0], c[1], (a - 190) % 40 ? 15.5 : 13.5, a), [x2, y2] = pt(c[0], c[1], 18, a)
    tk += `M${x1} ${y1}L${x2} ${y2}`
  }
  s += path(tk, { c: '#FFFFFF', w: 0.7, op: 0.75 })
  const [ax, ay] = pt(c[0], c[1], 20.5, 190), [bx, by] = pt(c[0], c[1], 20.5, 350)
  s += path(`M${ax} ${ay}A20.5 20.5 0 0 1 ${bx} ${by}`, { c: '#FFFFFF', w: 0.6, op: 0.5 })
  const [rx, ry] = pt(c[0], c[1], 20.5, 320)
  s += path(`M${rx} ${ry}A20.5 20.5 0 0 1 ${bx} ${by}`, { c: C.red, w: 1.4 })
  const [nx, ny] = pt(c[0], c[1], 16, 292)
  s += ln(c[0], c[1], nx, ny, { c: C.gold, w: 1.2, cap: 'round' }) + circ(c[0], c[1], 2, { fill: C.gold })
  return icon(50, 28, s, 'margin:0 auto 1px')
}
function scope(w = 360, h = 30) {
  let s = rect(0.5, 0.5, w - 1, h - 1, { c: C.purple, w: 0.6, op: 0.35, fill: C.bg })
  s += `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="${C.purple}" stroke-width="${h - 2}" stroke-dasharray="0.3 11.7" opacity="0.12"/>`
  s += ln(0, h / 2, w, h / 2, { op: 0.25, w: 0.4 }) + ticks(0, w, h / 2, 2, 2.4, { op: 0.3, w: 0.3 })
  s += path(wave(0, w, h / 2, 8, 60, 0), { c: C.purple, w: 1.1 })
  s += path(wave(0, w, h / 2, 8, 60, 120), { c: C.gold, w: 0.8, dash: '2 1.5' })
  s += ln(258, 1, 258, h - 1, { c: C.red, w: 0.6, dash: '1.5 1.5' }) + `<path d="M255 1L261 1L258 4.5Z" fill="${C.red}"/>`
  s += rect(266, h - 10, 92, 8, { fill: C.bg }) + t(357, h - 3.6, 5.2, 'CH1 50.00Hz · 2V/div', { anchor: 'end', op: 0.75 })
  s += rect(2, 2, 34, 7, { fill: C.bg }) + t(4, 7.4, 4.8, 'SCOPE · Δt 20ms', { op: 0.7 })
  return svg(w, h, s, 'margin:6px 0 0')
}
function moduleH1(n = '01', en = 'PART 01 // MUNICH · SIEMENS', zh = '走进慕尼黑：工业 4.0 现场课') {
  const top = svg(360, 18,
    t(0, 8, 6.2, `SECTION ${n} / 04`, { fw: 700, ls: 1, op: 0.85 }) + ln(0, 14, 296, 14, { op: 0.4, w: 0.5 }) +
    ticks(0, 296, 12, 3, 5, { op: 0.35 }) + ticks(0, 296, 11, 5, 25, { op: 0.6, w: 0.7 }) +
    `<path d="M304 16L308 6H322L318 16Z" fill="${C.black}"/><path d="M320 16L324 6H338L334 16Z" fill="${C.red}"/><path d="M336 16L340 6H354L350 16Z" fill="${C.gold}"/>` +
    rect(357, 6, 3, 10, { fill: C.purple }), 'margin:0 0 4px')
  return `<section style="margin:32px 0 20px;box-sizing:border-box">${top}` +
    `<section style="display:flex;align-items:stretch;border:1px solid rgba(102,8,116,0.45);background-color:#FFFFFF">` +
    `<section style="width:66px;flex-shrink:0;background-color:#5A0E78;background-image:linear-gradient(160deg,#660874 0%,#1E3A8A 100%);padding:7px 0 8px;text-align:center">${gauge()}` +
    `<p style="margin:0;font-size:26px;line-height:1.1;font-weight:700;color:#FFFFFF;font-family:${NUM_CSS};letter-spacing:1px;text-align:center">${n}</p></section>` +
    `<section style="flex:1;min-width:0;padding:10px 12px 10px 14px;display:flex;flex-direction:column;justify-content:center">` +
    `<p style="margin:0 0 3px;font-size:10px;line-height:1.4;color:#1E3A8A;letter-spacing:1.5px;font-family:${MONO_CSS};font-weight:700">${esc(en)}</p>` +
    `<p style="margin:0;font-size:19px;line-height:1.45;font-weight:700;color:#18181B;letter-spacing:1px">${esc(zh)}</p></section></section>` +
    `${scope()}</section>`
}
const SCREW = icon(9, 9, circ(4.5, 4.5, 3.6, { c: C.purple, w: 0.8, fill: C.white }) + path('M2.5 4.5H6.5M4.5 2.5V6.5', { w: 0.7 }), 'margin:0 0 0 9px')
function moduleH2Circuit(text = '二级标题 · 实验室见闻') {
  const ic = icon(24, 24, circ(12, 12, 11.5, { fill: C.purple }) +
    path('M4 12H8l1 -2.6l2 5.2l2 -5.2l2 5.2l1 -2.6H20', { c: C.white, w: 1, join: 'round', cap: 'round' }) +
    circ(4.5, 12, 1.5, { fill: C.gold }) + circ(19.5, 12, 1.5, { fill: C.white }))
  const lead = `<section style="flex:1;min-width:0;margin-left:10px;line-height:0">` +
    `<svg viewBox="0 0 300 12" width="100%" height="12" preserveAspectRatio="xMinYMid slice" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:12px;overflow:hidden">` +
    rect(0, 4.5, 9, 3, { fill: C.black }) + rect(9, 4.5, 9, 3, { fill: C.red }) + rect(18, 4.5, 9, 3, { fill: C.gold }) +
    ln(30, 6, 300, 6, { op: 0.4, w: 0.6 }) + ticks(30, 300, 6, 5, 6, { op: 0.3 }) + circ(30, 6, 1.6, { fill: C.purple }) + `</svg></section>`
  return `<section style="display:flex;align-items:center;margin:26px 0 14px;box-sizing:border-box">` +
    `<section style="display:flex;align-items:center;flex-shrink:0;max-width:78%;border:1px solid rgba(102,8,116,0.55);border-radius:15px;background-color:#F8F7FA;padding:2px 10px 2px 2px">${ic}` +
    `<p style="margin:0 0 0 8px;font-size:15px;line-height:1.5;font-weight:700;color:#660874;letter-spacing:1px">${esc(text)}</p>${SCREW}</section>${lead}</section>`
}
function moduleH2Gear(text = '二级标题 · 德国工业现场') {
  const ic = icon(22, 22, path(gear(11, 11, 10, 7.6, 10), { fill: C.white, c: C.purple, w: 1.1, join: 'round' }) +
    circ(11, 11, 3.4, { c: C.purple, w: 1.1 }) + circ(11, 11, 1.2, { fill: C.red }), 'margin:0 8px 0 2px')
  const flag = icon(3, 24, rect(0, 0, 3, 8, { fill: C.black }) + rect(0, 8, 3, 8, { fill: C.red }) + rect(0, 16, 3, 8, { fill: C.gold }), 'margin:0 8px 0 0')
  const lead = `<section style="flex:1;min-width:0;margin-left:8px;line-height:0">` +
    `<svg viewBox="0 0 300 14" width="100%" height="14" preserveAspectRatio="xMinYMid slice" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:14px;overflow:hidden">` +
    `<path d="M0 7L5 4V10Z" fill="${C.black}"/>` + ln(5, 7, 300, 7, { c: C.black, w: 0.6, dash: '3 2', op: 0.55 }) +
    ln(5, 2.5, 5, 11.5, { c: C.black, w: 0.6, op: 0.55 }) + t(14, 5, 4.6, 'DIN 476 · Ø 12', { fill: C.black, op: 0.55 }) + `</svg></section>`
  return `<section style="display:flex;align-items:center;margin:26px 0 14px;box-sizing:border-box">` +
    `<section style="display:flex;align-items:center;flex-shrink:0;max-width:80%;border:1px solid #18181B;border-radius:2px;background-color:#FFFFFF;padding:0 12px 0 0">${flag}${ic}` +
    `<p style="margin:0;font-size:15px;line-height:1.6;font-weight:700;color:#18181B;letter-spacing:1px;padding:3px 0">${esc(text)}</p></section>${lead}</section>`
}
function moduleDividerMotor() {
  let s = ln(0, 20, 360, 20, { op: 0.2, w: 0.4 }) + ticks(0, 104, 20, 3, 4, { op: 0.25 }) + ticks(256, 360, 20, 3, 4, { op: 0.25 })
  s += path(wave(2, 112, 20, 0, 9, 0, 0.6, (x) => 0.6 + 8 * Math.pow((x - 2) / 110, 2.2)), { w: 0.75, op: 0.85 })
  s += path(wave(248, 358, 20, 0, 9, 180, 0.6, (x) => 0.6 + 8 * Math.pow((358 - x) / 110, 2.2)), { w: 0.75, op: 0.85 })
  s += diamond(146, 20, 3.4, C.black) + diamond(134, 20, 3.4, C.red) + diamond(122, 20, 3.4, C.gold)
  s += diamond(214, 20, 3.4, C.black) + diamond(226, 20, 3.4, C.red) + diamond(238, 20, 3.4, C.gold)
  // 电机截面：定子槽 + 旋转转子
  s += circ(180, 20, 15.5, { c: C.purple, w: 1.1, fill: C.white }) + circ(180, 20, 11, { c: C.purple, w: 0.6 })
  let slots = ''
  for (let a = 0; a < 360; a += 30) {
    const [x1, y1] = pt(180, 20, 11, a), [x2, y2] = pt(180, 20, 14.4, a)
    slots += `M${x1} ${y1}L${x2} ${y2}`
  }
  s += path(slots, { w: 1.6, op: 0.85 })
  let rotor = circ(180, 20, 7, { fill: C.purple, op: 0.12 }) + circ(180, 20, 7, { c: C.purple, w: 0.8 })
  for (const [a, col] of [[-90, C.purple], [30, C.blue], [150, C.gold]]) {
    const [x, y] = pt(180, 20, 6, a)
    rotor += ln(180, 20, x, y, { c: col, w: 1.2, cap: 'round' })
  }
  s += `<g>${rotor}${spin(180, 20, 6)}</g>` + circ(180, 20, 1.6, { fill: C.black })
  s += t(0, 37, 4.4, 'HV PULSE · ±400kV', { op: 0.55 }) + t(360, 37, 4.4, 'STATOR 12S · ROTOR 2P', { op: 0.55, anchor: 'end' })
  return `<section style="margin:24px 0;box-sizing:border-box">${svg(360, 40, s)}</section>`
}
function moduleDividerPCB() {
  let s = path('M0 14H118L126 6H160M200 6H234L242 14H360', { w: 0.9, op: 0.75, join: 'round' })
  s += path('M0 18H122L128 12H160M200 12H232L238 18H360', { w: 0.5, op: 0.35, join: 'round' })
  for (const [x, y] of [[118, 14], [126, 6], [234, 6], [242, 14], [60, 14], [300, 14]]) s += circ(x, y, 2, { c: C.purple, w: 0.8, fill: C.white })
  s += rect(160, 2, 40, 16, { fill: C.black, rx: 1 }) + ticks(162, 198, 1, 2, 4, { c: C.purple, op: 0.8, w: 1.2 }) + ticks(162, 198, 19, 2, 4, { c: C.purple, op: 0.8, w: 1.2 })
  s += t(180, 12.4, 5.2, 'EEA·26', { fill: C.white, anchor: 'middle', fw: 700, ls: 0.8 }) + circ(164, 5, 0.9, { fill: C.gold })
  s += rect(80, 12.5, 6, 3, { fill: C.black }) + rect(86, 12.5, 6, 3, { fill: C.red }) + rect(92, 12.5, 6, 3, { fill: C.gold })
  s += rect(262, 12.5, 6, 3, { fill: C.gold }) + rect(268, 12.5, 6, 3, { fill: C.red }) + rect(274, 12.5, 6, 3, { fill: C.black })
  return `<section style="margin:24px 0;box-sizing:border-box">${svg(360, 22, s)}</section>`
}

// ============ 4/5/6/7. 图片模块 ============
function moduleSingle(id = '1587330979470-3595ac045ab0', cap = '图｜柏林 · 勃兰登堡门夜景') {
  const top = svg(360, 18,
    path('M0.75 17V0.75H15', { w: 1.5 }) + path(`M345 0.75H359.25V17`, { c: C.gold, w: 1.5 }) +
    circ(26, 8, 1.8, { fill: C.red, inner: blink(1.2) }) + t(31, 10, 5.6, 'REC · CAM-01 · VIEWFINDER', { fw: 700, ls: 0.6, op: 0.85 }) +
    t(334, 10, 5.2, 'f/8 · 1/250s · ISO 200', { anchor: 'end', op: 0.65 }) + ticks(22, 338, 15.5, 2.5, 4, { op: 0.3 }) + ticks(22, 338, 15, 3.5, 40, { op: 0.6, w: 0.7 }))
  const bottom = svg(360, 18,
    path('M0.75 1V17.25H15', { c: C.gold, w: 1.5 }) + path('M345 17.25H359.25V1', { w: 1.5 }) +
    path('M174 9H186M180 3V15', { w: 0.6, op: 0.6 }) + circ(180, 9, 3.2, { c: C.purple, w: 0.6, op: 0.6 }) +
    t(22, 11, 4.8, 'FRAME 3:2 · 1080×720', { op: 0.55 }) + t(338, 11, 4.8, 'EEA-DE / IMG-001', { op: 0.55, anchor: 'end' }))
  return `<section style="margin:22px 0;box-sizing:border-box">${top}<section style="padding:2px 9px;line-height:0;margin:0">${IMG(id, 1080, 720, '单图 · 建议 3:2（1080×720）')}</section>${bottom}${capRow(cap)}</section>`
}
function dualA(a, b, capA, capB, joint, ratio = [960, 720]) {
  const col = (id, tag, cap) => `<section style="width:48.5%;flex-shrink:0">${colTag(tag)}${IMG(id, ratio[0], ratio[1], `双图 · 建议 4:3（${ratio[0]}×${ratio[1]}）`)}${capRow(cap)}</section>`
  const link = svg(360, 14,
    path('M87.3 0V5H272.7V0', { w: 0.6, op: 0.5 }) + ln(180, 5, 180, 12, { w: 0.6, op: 0.5 }) +
    circ(87.3, 1.5, 1.5, { fill: C.purple }) + circ(272.7, 1.5, 1.5, { fill: C.purple }) + circ(180, 5, 2.2, { fill: C.gold }) +
    ticks(95, 172, 5, 2, 4, { op: 0.35 }) + ticks(188, 265, 5, 2, 4, { op: 0.35 }), 'margin:2px 0 0')
  return `<section style="margin:22px 0;box-sizing:border-box"><section style="display:flex;justify-content:space-between;align-items:flex-start">` +
    col(a, 'IMG 01', capA) + col(b, 'IMG 02', capB) + `</section>${link}${capRow(joint, NODE)}</section>`
}
const moduleDualA = () => dualA('1548337138-e87d889cc369', '1473341304170-971dccb5ac1e', '图｜风电机组', '图｜输电铁塔', '组图｜从风电场到输电走廊，能源从这里出发（联合注释，可删除）')
function moduleDualB() {
  const deco = svg(140, 96,
    t(0, 22, 20, 'Nº02', { fill: C.purple, ff: 'DIN Alternate, Bahnschrift, Helvetica Neue, Arial, sans-serif', fw: 700, ls: 0.5 }) +
    t(1, 33, 5.4, 'EEA × DE · FIELD', { op: 0.7, ls: 0.8 }) +
    ln(0, 92, 54, 44, { c: C.black, w: 1.2 }) + ln(10, 92, 64, 44, { c: C.red, w: 1.2 }) + ln(20, 92, 74, 44, { c: C.gold, w: 1.2 }) +
    circ(74, 44, 1.8, { fill: C.gold }) + ln(74, 44, 112, 44, { c: C.gold, w: 0.6, dash: '2 1.5' }) +
    path('M112 4V92M109 4H115M109 92H115', { w: 0.5, op: 0.5 }) + `<path d="M112 4L110.4 8H113.6Z" fill="${C.purple}" opacity="0.6"/><path d="M112 92L110.4 88H113.6Z" fill="${C.purple}" opacity="0.6"/>` +
    t(133, 48, 5.6, 'MÜNCHEN · I4.0', { anchor: 'middle', ls: 1.4, fw: 700, tr: 'rotate(90 133 48)', op: 0.8 }), 'margin:0 0 6px')
  return `<section style="margin:22px 0;display:flex;justify-content:space-between;align-items:flex-start;box-sizing:border-box">` +
    `<section style="width:58%;flex-shrink:0">${colTag('IMG 01', 'MAIN')}${IMG('1595867818082-083862f3d630', 800, 1000, '主图 · 建议 4:5（800×1000）')}${capRow('图｜慕尼黑城市天际线')}</section>` +
    `<section style="width:39%;flex-shrink:0">${deco}${IMG('1716191299980-a6e8827ba10b', 600, 800, '副图 · 建议 3:4（600×800）')}${capRow('图｜工业机器人')}</section></section>`
}
function moduleTripleA() {
  const head = svg(360, 14, rect(0, 0, 52, 10, { fill: C.purple }) + t(26, 7.3, 5.6, 'FIG.06-A', { fill: C.white, anchor: 'middle', fw: 700, ls: 0.8 }) +
    ln(52, 9.5, 360, 9.5, { op: 0.35 }) + ticks(58, 330, 7, 3, 5, { op: 0.3 }) + rect(336, 6, 8, 3, { fill: C.black }) + rect(344, 6, 8, 3, { fill: C.red }) + rect(352, 6, 8, 3, { fill: C.gold }), 'margin:0 0 3px')
  const link = svg(360, 22,
    ln(180, 0, 180, 9, { w: 0.8 }) + path('M87.3 22V9H272.7V22', { w: 0.8, join: 'round' }) + ticks(92, 268, 9, 3, 4, { op: 0.35 }) +
    circ(180, 9, 2.6, { fill: C.gold, c: C.purple, w: 0.6 }) + circ(87.3, 9, 1.8, { fill: C.white, c: C.purple, w: 0.8 }) + circ(272.7, 9, 1.8, { fill: C.white, c: C.purple, w: 0.8 }) +
    t(186, 5.6, 4.6, 'Δ 1 : 2 SPLIT', { op: 0.6 }), 'margin:0')
  const small = (id, tag, cap) => `<section style="width:48.5%;flex-shrink:0">${colTag(tag)}${IMG(id, 960, 720, '小图 · 建议 4:3（960×720）')}${capRow(cap)}</section>`
  return `<section style="margin:22px 0;box-sizing:border-box">${head}${IMG('1647427060118-4911c9821b82', 1280, 720, '大图 · 建议 16:9（1280×720）')}${capRow('图｜智能制造产线（单图注释，可删除）')}${link}` +
    `<section style="display:flex;justify-content:space-between;align-items:flex-start">${small('1518770660439-4636190af475', 'IMG 02', '图｜功率电子电路板')}${small('1581091226033-d5c48150dbaa', 'IMG 03', '图｜自动化实验室')}</section>` +
    `${capRow('组图｜一条产线背后的电力电子与控制系统（统一注释，可删除）', NODE)}</section>`
}
function moduleTripleB() {
  // 右栏两张 3:2 图 + 中间 SVG 间隔条（宽 175、高 10.85 = 栏宽 6.2%）与左侧 1000×1396 竖图等高
  const gap = svg(175, 10.85, ln(0, 5.4, 175, 5.4, { op: 0.35, w: 0.5 }) + ticks(4, 171, 5.4, 3, 5, { op: 0.4 }) + circ(87.5, 5.4, 2, { fill: C.gold, c: C.purple, w: 0.6 }) + rect(0, 4, 4, 2.8, { fill: C.purple }) + rect(171, 4, 4, 2.8, { fill: C.purple }))
  return `<section style="margin:22px 0;box-sizing:border-box">` +
    `<section style="display:flex;justify-content:space-between;align-items:flex-start">` +
    `<section style="width:48.5%;flex-shrink:0;line-height:0">${IMG('1566404791232-af9fe0ae8f8b', 1000, 1396, '竖图 · 建议 5:7（1000×1396）')}</section>` +
    `<section style="width:48.5%;flex-shrink:0;line-height:0">${IMG('1552035496-08efc7baf40e', 960, 640, '横图 · 建议 3:2（960×640）')}${gap}${IMG('1527295110-5145f6b148d0', 960, 640, '横图 · 建议 3:2（960×640）')}</section></section>` +
    `${capRow('左｜柏林电视塔　右上｜国会大厦　右下｜德铁 ICE 列车（统一注释，可删除）', DWG)}</section>`
}
function moduleQuad() {
  const head = svg(360, 14, t(0, 8, 6, 'MATRIX 2×2 · FIELD ARCHIVE', { fw: 700, ls: 1, op: 0.85 }) + ln(120, 6, 340, 6, { op: 0.35, w: 0.5 }) + ticks(120, 340, 6, 3, 5, { op: 0.3 }) + rect(344, 4.5, 16, 3, { fill: C.purple }), 'margin:0 0 4px')
  const cell = (id, n, cap) => `<section style="width:48.5%;flex-shrink:0"><section style="line-height:0">${IMG(id, 960, 720, '四图 · 建议 4:3（960×720）')}</section>${badge(n)}${capRow(cap)}</section>`
  // 十字罗盘：紫荆花瓣 × 齿轮
  let e = ln(0, 15, 160, 15, { op: 0.35, w: 0.5 }) + ln(200, 15, 360, 15, { op: 0.35, w: 0.5 }) + ticks(4, 156, 15, 3, 6, { op: 0.35 }) + ticks(204, 356, 15, 3, 6, { op: 0.35 })
  e += diamond(160, 15, 2, C.purple) + diamond(200, 15, 2, C.purple)
  e += path('M180 0V4M180 26V30', { w: 0.8 }) + t(180, 3.6, 3.4, 'N', { anchor: 'middle', op: 0 })
  let g = path(gear(180, 15, 13.5, 11, 12), { fill: C.white, c: C.black, w: 0.8, join: 'round' })
  g += circ(180, 15, 9.2, { c: C.purple, w: 0.5, op: 0.6 })
  for (let i = 0; i < 5; i++) g += `<ellipse cx="180" cy="10.6" rx="2.3" ry="4.4" fill="${C.purple}" fill-opacity="0.88" transform="rotate(${i * 72 + 8} 180 15)"/>`
  g += circ(180, 15, 1.5, { fill: C.gold })
  e += `<g>${g}${spin(180, 15, 24)}</g>`
  e += t(150, 26, 4.2, 'TSINGHUA', { op: 0.6, anchor: 'end', ls: 0.6 }) + t(210, 26, 4.2, 'DEUTSCHLAND', { op: 0.6, ls: 0.6 })
  const band = svg(360, 30, e, 'margin:4px 0')
  return `<section style="margin:22px 0;box-sizing:border-box">${head}` +
    `<section style="display:flex;justify-content:space-between;align-items:flex-start">${cell('1509391366360-2e959784a276', '01', '光伏电站')}${cell('1508791290064-c27cc1ef7a9a', '02', '风电场')}</section>${band}` +
    `<section style="display:flex;justify-content:space-between;align-items:flex-start">${cell('1577462282244-b58c2816d686', '03', '慕尼黑城区')}${cell('1538685634737-24b83e3fa2f8', '04', '柏林大教堂')}</section>` +
    `${capRow('组图｜实践途中的能源与城市（统一注释，可删除）', NODE)}</section>`
}
function moduleCarousel() {
  let s = path(wave(0, 360, 15, 4, 24, 0), { op: 0.18, w: 0.6 })
  s += rect(54, 6, 252, 18, { fill: C.white }) + rect(54, 6, 252, 18, { c: C.purple, w: 0.6, op: 0.4, rx: 9 })
  s += t(180, 17.6, 6.8, 'SWIPE TO EXPLORE · 左右滑动浏览实践图集', { anchor: 'middle', fw: 700, ls: 0.5, ff: `${MONO}, ${SANS}` })
  const chev = (x, dir) => [0, 6, 12].map((d, i) => path(`M${x + dir * d + 3 * dir} 10L${x + dir * d} 15L${x + dir * d + 3 * dir} 20`, { c: [C.black, C.red, C.gold][i], w: 1.3, cap: 'round', join: 'round' })).join('')
  s += `<g>${chev(36, 1)}<animateTransform attributeName="transform" type="translate" values="0 0;-4 0;0 0" dur="1.4s" repeatCount="indefinite"/></g>`
  s += `<g>${chev(324, -1)}<animateTransform attributeName="transform" type="translate" values="0 0;4 0;0 0" dur="1.4s" repeatCount="indefinite"/></g>`
  const cards = [
    ['1552035496-08efc7baf40e', 'BERLIN', '国会大厦穹顶'],
    ['1577462282244-b58c2816d686', 'MÜNCHEN', '慕尼黑城区'],
    ['1527295110-5145f6b148d0', 'DB ICE', '城际列车上的讨论'],
    ['1508791290064-c27cc1ef7a9a', 'WINDPARK', '风电场参访'],
    ['1581092160607-ee22621dd758', 'LAB', '实验室动手环节'],
  ]
  const card = ([id, place, cap], i) =>
    `<section style="flex-shrink:0;flex-grow:0;width:85%;margin:0 ${i === cards.length - 1 ? 0 : '3%'} 0 0;border:1px solid rgba(102,8,116,0.2);background-color:#FFFFFF;padding:6px;box-sizing:border-box">` +
    svg(300, 13, rect(0, 0, 30, 9, { fill: C.purple }) + t(15, 6.6, 5.4, `0${i + 1}/05`, { fill: C.white, anchor: 'middle', fw: 700 }) + t(36, 7, 5.4, place, { fw: 700, ls: 1 }) +
      ln(36, 11.5, 300, 11.5, { op: 0.3 }) + ticks(150, 288, 8, 2.5, 5, { op: 0.3 }) + rect(292, 5, 8, 3, { fill: C.gold }), 'margin:0 0 4px') +
    `<section style="line-height:0">${IMG(id, 1080, 720, '轮播 · 建议 3:2（1080×720）')}</section>${capRow(`图｜${cap}`)}</section>`
  const track = `<section style="display:flex;flex-wrap:nowrap;overflow-x:scroll;-webkit-overflow-scrolling:touch;width:100%;margin:6px 0 0;padding:0 0 6px;box-sizing:border-box">${cards.map(card).join('')}</section>`
  const prog = svg(360, 10, [0, 1, 2, 3, 4].map((i) => rect(130 + i * 20, 4, 16, 2, { fill: i ? C.purple : C.purple, op: i ? 0.2 : 1 })).join('') +
    t(0, 7, 4.8, 'CAROUSEL · 85% CARD', { op: 0.55 }) + t(360, 7, 4.8, '01 → 05', { op: 0.55, anchor: 'end' }), 'margin:4px 0 0')
  return `<section style="margin:22px 0;box-sizing:border-box">${svg(360, 30, s)}${track}${prog}</section>`
}

// ============ 3. 大型自适应文本框 ============
function moduleMaster() {
  const SIDE = 'rgba(102,8,116,0.25)'
  const bar = svg(360, 30,
    t(12, 19.5, 10, 'FIELD NOTES · 实践手记', { fill: C.white, fw: 700, ls: 1, ff: `${SANS}` }) +
    t(348, 12.5, 5.4, 'DWG NO. EEA-DE-2026-03', { fill: C.white, anchor: 'end', op: 0.85, ls: 0.5 }) +
    t(348, 21.5, 5.4, 'SHEET 03 / 09 · REV.A', { fill: C.white, anchor: 'end', op: 0.65, ls: 0.5 }) +
    circ(178, 15, 2.6, { fill: C.black, c: C.white, w: 0.5 }) + circ(188, 15, 2.6, { fill: C.red, c: C.white, w: 0.5, inner: blink(2) }) + circ(198, 15, 2.6, { fill: C.gold, c: C.white, w: 0.5 }) +
    circ(4.5, 4.5, 1.6, { c: C.white, w: 0.5, op: 0.7 }) + circ(355.5, 4.5, 1.6, { c: C.white, w: 0.5, op: 0.7 }) + circ(4.5, 25.5, 1.6, { c: C.white, w: 0.5, op: 0.7 }) + circ(355.5, 25.5, 1.6, { c: C.white, w: 0.5, op: 0.7 }) +
    ticks(12, 348, 28.5, 2, 5, { c: C.white, op: 0.35, w: 0.4 }))
  // 游标卡尺：主尺 4 单位、副尺 3.6 单位
  const vernier = (x0, dir) => ticks(x0, x0 + dir * 40, 2.5, 5, 4, { op: 0.55, w: 0.5 }) + ticks(x0, x0 + dir * 36, 8.5, 5, 3.6, { c: C.blue, op: 0.55, w: 0.5 })
  const sub = svg(360, 14,
    ln(0.75, 0, 0.75, 14, { c: C.purple, w: 1.5, op: 0.25 }) + ln(359.25, 0, 359.25, 14, { c: C.purple, w: 1.5, op: 0.25 }) +
    vernier(6, 1) + vernier(354, -1) + ln(52, 5.5, 308, 5.5, { op: 0.2, w: 0.4, dash: '3 2' }) + t(180, 8, 4.6, 'MEASURED · NOT TO SCALE', { anchor: 'middle', op: 0.45, ls: 0.8 }))
  const foot = svg(360, 40,
    ln(0.75, 0, 0.75, 39.25, { c: C.purple, w: 1.5, op: 0.25 }) + ln(359.25, 0, 359.25, 39.25, { c: C.purple, w: 1.5, op: 0.25 }) + ln(0, 39.25, 360, 39.25, { c: C.purple, w: 1.5, op: 0.25 }) +
    vernier(6, 1) + rect(196, 14, 160, 22, { c: C.purple, w: 0.6, op: 0.6, fill: C.white }) +
    ln(196, 25, 356, 25, { op: 0.4, w: 0.5 }) + ln(236, 14, 236, 36, { op: 0.4, w: 0.5 }) + ln(276, 14, 276, 36, { op: 0.4, w: 0.5 }) + ln(316, 14, 316, 36, { op: 0.4, w: 0.5 }) +
    t(216, 21.6, 4.6, 'DRAWN', { anchor: 'middle', op: 0.6 }) + t(256, 21.6, 4.6, 'CHECKED', { anchor: 'middle', op: 0.6 }) + t(296, 21.6, 4.6, 'SCALE', { anchor: 'middle', op: 0.6 }) + t(336, 21.6, 4.6, 'REV', { anchor: 'middle', op: 0.6 }) +
    t(216, 32.6, 5.2, 'EEA', { anchor: 'middle', fw: 700 }) + t(256, 32.6, 5.2, 'TEAM', { anchor: 'middle', fw: 700 }) + t(296, 32.6, 5.2, '1 : 1', { anchor: 'middle', fw: 700 }) + t(336, 32.6, 5.2, 'A', { anchor: 'middle', fw: 700, fill: C.red }) +
    circ(12, 26, 2.4, { fill: C.black }) + circ(20, 26, 2.4, { fill: C.red }) + circ(28, 26, 2.4, { fill: C.gold }) + t(35, 28, 4.8, 'STATUS · OK', { op: 0.6, ls: 0.6 }) +
    path(wave(80, 188, 28, 3, 18, 0), { c: C.blue, w: 0.5, op: 0.4 }))
  const quote = `<section style="margin:4px 0 18px;border:1px solid rgba(102,8,116,0.15);border-left:3px solid #660874;background-color:#F8F7FA;padding:10px 14px 12px;box-sizing:border-box">` +
    svg(300, 12, path('M0 11V6.5Q0 2 4.5 1.2V3.4Q2.4 4 2.4 6.2H4.6V11ZM7 11V6.5Q7 2 11.5 1.2V3.4Q9.4 4 9.4 6.2H11.6V11Z', { fill: C.purple, c: 'none' }) +
      t(18, 9, 5.8, 'KEY INSIGHT · 引用高亮', { fw: 700, ls: 1 }) + rect(276, 5, 8, 3, { fill: C.black }) + rect(284, 5, 8, 3, { fill: C.red }) + rect(292, 5, 8, 3, { fill: C.gold })) +
    `<p style="margin:8px 0 0;font-size:14px;color:#000000;line-height:1.85;letter-spacing:0.8px;text-align:justify;font-weight:700">“能源转型不是某一项技术的胜利，而是整套系统的重新设计。”</p>` +
    `<p style="${CAP}margin:6px 0 0;text-align:right">—— 交流嘉宾 · 埃尔朗根（示例）</p></section>`
  const nestedDual = dualA('1509390144018-eeaf65052242', '1581092160607-ee22621dd758', '图｜变电设备', '图｜实验室操作', '组图｜嵌套在文本框内的双图模块（宽度随容器自适应）', [800, 600])
  const body =
    `<p style="${P}">七月的埃尔朗根，清晨的空气里带着一丝凉意。支队成员走进当地一家能源装备企业的实验室，第一次近距离观察大型变流器的测试平台。从清华园课堂里的电路图，到眼前真实运转的设备，<strong style="color:#660874">每一条走线都有了重量</strong>。</p>` +
    nestedDual +
    `<p style="${P}">在讲解环节，工程师从电网频率稳定讲到新能源并网，从功率半导体讲到数字孪生。同学们带着课堂上的问题提问，也把各自的研究方向带进了讨论。</p>` +
    quote +
    `<p style="${P}margin-bottom:0">回到住处，大家把一天的记录整理成笔记：数据、照片和尚未想清楚的问题。正是这些问题，构成了这次实践最珍贵的部分。（以上为示例正文，可直接替换。）</p>`
  return `<section style="margin:24px 0;width:100%;box-sizing:border-box;height:auto">` +
    `<section style="background-color:#45197F;background-image:linear-gradient(90deg,#660874 0%,#1E3A8A 100%);line-height:0">${bar}</section>${sub}` +
    `<section style="border-left:1.5px solid ${SIDE};border-right:1.5px solid ${SIDE};padding:20px 16px;background-color:#FFFFFF;background-image:linear-gradient(rgba(102,8,116,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(102,8,116,0.05) 1px,transparent 1px);background-size:14px 14px;box-sizing:border-box;width:100%;height:auto">${body}</section>` +
    `${foot}</section>`
}

// ============ 9. 尾声与铭牌 ============
function motorEmblem() {
  let s = circ(50, 50, 46, { c: C.purple, w: 2.2 }) + circ(50, 50, 33, { c: C.purple, w: 0.9 })
  let slots = ''
  for (let a = 0; a < 360; a += 15) {
    const [x1, y1] = pt(50, 50, 34, a), [x2, y2] = pt(50, 50, 42, a)
    slots += `M${x1} ${y1}L${x2} ${y2}`
  }
  s += path(slots, { w: 3, op: 0.9 })
  for (const [a0, col] of [[-80, C.purple], [40, C.blue], [160, C.gold]]) {
    const [x1, y1] = pt(50, 50, 48.6, a0), [x2, y2] = pt(50, 50, 48.6, a0 + 100)
    s += path(`M${x1} ${y1}A48.6 48.6 0 0 1 ${x2} ${y2}`, { c: col, w: 1.4, cap: 'round' })
  }
  s += circ(50, 50, 27, { fill: C.purple }) + circ(50, 50, 27, { c: C.blue, w: 1.2 })
  let bars = ''
  for (let a = 0; a < 360; a += 22.5) { const [x, y] = pt(50, 50, 22, a); bars += circ(x, y, 1.5, { fill: C.white, op: 0.8 }) }
  s += bars + t(50, 54, 11, 'EEA', { fill: C.white, anchor: 'middle', fw: 700, ls: 1.5, ff: 'DIN Alternate, Bahnschrift, Helvetica Neue, Arial, sans-serif' })
  s += t(50, 63.5, 3.6, 'SINCE 1932', { fill: C.white, anchor: 'middle', op: 0 })
  return svg(100, 100, s)
}
function routeMap() {
  let s = t(6, 9, 5.4, 'ROUTE · 实践路线', { fw: 700, ls: 0.8, ff: `${MONO}, ${SANS}` }) + ticks(80, 334, 7, 2, 5, { op: 0.25 })
  const st = [[30, '北京', 'BEIJING'], [138, '慕尼黑', 'MÜNCHEN'], [226, '埃尔朗根', 'ERLANGEN'], [310, '柏林', 'BERLIN']]
  s += path('M30 38Q84 6 138 38', { c: C.purple, w: 0.9, dash: '3 2' })
  // 飞机
  s += path('M78 22H90M86 22L82 17.5M86 22L82 26.5M79.5 22L78 19.5M79.5 22L78 24.5', { c: C.purple, w: 1.1, cap: 'round' })
  s += ln(138, 38, 310, 38, { c: C.purple, w: 3 }) + ln(138, 38, 310, 38, { c: C.white, w: 1.2, dash: '4 4' })
  const train = (x) => rect(x - 7, 23, 14, 7, { c: C.blue, w: 0.8, fill: C.white, rx: 2.5 }) + rect(x - 5, 24.8, 3, 2.2, { fill: C.blue }) + rect(x - 1, 24.8, 3, 2.2, { fill: C.blue }) + rect(x + 3, 24.8, 2.4, 2.2, { fill: C.blue }) + ln(x - 6, 31.5, x + 6, 31.5, { c: C.blue, w: 0.6 })
  s += train(182) + train(268)
  s += t(84, 13, 4.4, 'FLIGHT', { anchor: 'middle', op: 0.6 }) + t(182, 19.5, 4.4, 'ICE', { anchor: 'middle', op: 0.6 }) + t(268, 19.5, 4.4, 'ICE', { anchor: 'middle', op: 0.6 })
  st.forEach(([x, zh, en], i) => {
    const fill = i === 0 ? C.purple : i === st.length - 1 ? C.gold : C.white
    s += circ(x, 38, 5, { fill, c: i === st.length - 1 ? C.black : C.purple, w: 1.6 })
    s += t(x, 56, 9, zh, { anchor: 'middle', fill: C.black, fw: 700, ff: SANS })
    s += t(x, 65.5, 5.8, en, { anchor: 'middle', fill: C.gray, ls: 0.5 })
  })
  return svg(340, 70, s, 'margin:0')
}
function moduleFooter() {
  const head = svg(360, 22, t(0, 9, 6.4, 'TITLE BLOCK // 支队铭牌', { fw: 700, ls: 1, ff: `${MONO}, ${SANS}` }) +
    ln(0, 15, 360, 15, { op: 0.35, w: 0.5 }) + ticks(0, 300, 18, 3, 5, { op: 0.3 }) +
    rect(306, 13.5, 18, 3, { fill: C.black }) + rect(324, 13.5, 18, 3, { fill: C.red }) + rect(342, 13.5, 18, 3, { fill: C.gold }), 'margin:0 0 4px')
  const label = (zh, en) => `<section style="width:30%;flex-shrink:0;background-color:#F8F7FA;padding:7px 8px;border-right:1px solid #18181B;box-sizing:border-box">` +
    `<p style="margin:0;font-size:9px;line-height:1.3;color:#660874;letter-spacing:1px;font-family:${MONO_CSS};font-weight:700">${en}</p>` +
    `<p style="margin:1px 0 0;font-size:12px;line-height:1.4;color:#18181B;font-weight:700">${zh}</p></section>`
  const row = (zh, en, val) => `<section style="display:flex;align-items:stretch;border-top:1px solid #18181B">${label(zh, en)}` +
    `<section style="flex:1;min-width:0;padding:7px 10px;display:flex;align-items:center"><p style="margin:0;font-size:13px;line-height:1.6;color:#000000;letter-spacing:0.5px">${val}</p></section></section>`
  const cell = (k, v, last) => `<section style="width:25%;flex-shrink:0;padding:5px 6px;box-sizing:border-box;${last ? '' : 'border-right:1px solid #18181B;'}">` +
    `<p style="margin:0;font-size:8px;line-height:1.3;color:#888888;letter-spacing:0.8px;font-family:${MONO_CSS}">${k}</p>` +
    `<p style="margin:1px 0 0;font-size:11px;line-height:1.4;color:#18181B;font-weight:700;font-family:${MONO_CSS}">${v}</p></section>`
  const tail = svg(360, 30, ln(0, 6, 150, 6, { op: 0.35, w: 0.5 }) + ln(210, 6, 360, 6, { op: 0.35, w: 0.5 }) +
    rect(162, 4.5, 12, 3, { fill: C.black }) + rect(174, 4.5, 12, 3, { fill: C.red }) + rect(186, 4.5, 12, 3, { fill: C.gold }) +
    t(180, 22, 7, 'E N D', { anchor: 'middle', fw: 700, ls: 2 }) + ticks(0, 150, 9, 2, 5, { op: 0.25 }) + ticks(210, 360, 9, 2, 5, { op: 0.25 }), 'margin:10px 0 0')
  return `<section style="margin:28px 0 8px;box-sizing:border-box">${head}` +
    `<section style="border:1.5px solid #18181B;background-color:#FFFFFF;box-sizing:border-box">` +
    `<section style="display:flex;align-items:stretch">` +
    `<section style="width:30%;flex-shrink:0;padding:8px;border-right:1px solid #18181B;box-sizing:border-box;line-height:0">${motorEmblem()}</section>` +
    `<section style="flex:1;min-width:0;padding:10px 10px;display:flex;flex-direction:column;justify-content:center">` +
    `<p style="margin:0;font-size:9px;line-height:1.3;color:#660874;letter-spacing:1.5px;font-family:${MONO_CSS};font-weight:700">PROJECT · 项目</p>` +
    `<p style="margin:4px 0 0;font-size:15px;line-height:1.5;color:#18181B;font-weight:700;letter-spacing:0.5px">清华大学电机系赴德国海外社会实践支队</p>` +
    `<p style="margin:4px 0 0;font-size:10px;line-height:1.4;color:#1E3A8A;letter-spacing:1px;font-family:${MONO_CSS}">TSINGHUA EEA · GERMANY · 2026</p></section></section>` +
    row('带队教师', 'ADVISOR', 'XXX 老师') + row('支队成员', 'MEMBERS', 'XXX　XXX　XXX　XXX　XXX') + row('摄影', 'PHOTO', 'XXX　XXX') + row('文案', 'TEXT', 'XXX') + row('排版', 'LAYOUT', 'XXX') +
    `<section style="display:flex;border-top:1px solid #18181B">${cell('DWG NO.', 'EEA-DE-26')}${cell('SCALE', '1 : 1')}${cell('SHEET', '09 / 09')}${cell('REV.', 'A', true)}</section>` +
    `<section style="border-top:1px solid #18181B;padding:6px 8px 4px;line-height:0">${routeMap()}</section>` +
    `</section>${tail}</section>`
}

// ============ 页面 ============
const MODULES = [
  { id: 'm1', no: '01', name: '刊头引导', en: 'Header Banner', html: moduleHeader() },
  { id: 'm2a', no: '02', name: '主章节标题 H1', en: 'Section Title', html: moduleH1() },
  { id: 'm2b', no: '02', name: '次级标题 H2 · 电路', en: 'Sub Title / Circuit', html: moduleH2Circuit() },
  { id: 'm2c', no: '02', name: '次级标题 H2 · 齿轮', en: 'Sub Title / Gear', html: moduleH2Gear() },
  { id: 'm2d', no: '02', name: '分割线 · 电机脉冲', en: 'Divider / Motor', html: moduleDividerMotor() },
  { id: 'm2e', no: '02', name: '分割线 · PCB 走线', en: 'Divider / PCB', html: moduleDividerPCB() },
  { id: 'm3', no: '03', name: '大型自适应文本框', en: 'Adaptive Master Container', html: moduleMaster() },
  { id: 'm4', no: '04', name: '单图精密画框', en: 'Single Image Frame', html: moduleSingle() },
  { id: 'm5a', no: '05', name: '双图 · 对称并排', en: 'Dual / Symmetric', html: moduleDualA() },
  { id: 'm5b', no: '05', name: '双图 · 包豪斯错落', en: 'Dual / Bauhaus', html: moduleDualB() },
  { id: 'm6a', no: '06', name: '三图 · 1 大 2 小', en: 'Triple / 1+2', html: moduleTripleA() },
  { id: 'm6b', no: '06', name: '三图 · 左竖右横', en: 'Triple / Portrait+2', html: moduleTripleB() },
  { id: 'm7', no: '07', name: '四图矩阵画廊', en: 'Quad Grid', html: moduleQuad() },
  { id: 'm8', no: '08', name: '滑动轮播', en: 'Carousel', html: moduleCarousel() },
  { id: 'm9', no: '09', name: '尾声与支队铭牌', en: 'Footer & Credits', html: moduleFooter() },
]

const IMAGES = [
  ['单图画框', '3:2', '1080×720'], ['双图 · 并排', '4:3', '960×720 ×2'], ['双图 · 错落', '4:5 + 3:4', '800×1000 / 600×800'],
  ['三图 · 1+2', '16:9 + 4:3', '1280×720 / 960×720 ×2'], ['三图 · 左竖右横', '5:7 + 3:2', '1000×1396 / 960×640 ×2'],
  ['四图矩阵', '4:3', '960×720 ×4'], ['轮播', '3:2', '1080×720 ×5'], ['文本框内双图', '4:3', '800×600 ×2'],
]

const page = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>EEA × Germany 推文模板库</title>
<style>
  :root { color-scheme: light; --ink:#18181B; --muted:#6B6B76; --line:#E4E1EA; --purple:#660874; --blue:#1E3A8A; --paper:#F3F1F6; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--paper); color: var(--ink); font: 14px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif; }
  a { color: var(--purple); }
  .layout { display: grid; grid-template-columns: 360px 1fr; min-height: 100vh; }
  .side { position: sticky; top: 0; height: 100vh; overflow: auto; padding: 28px 26px 40px; background: #FFFFFF; border-right: 1px solid var(--line); }
  .side h1 { margin: 0; font-size: 20px; line-height: 1.35; letter-spacing: .5px; }
  .side .kicker { font: 700 11px/1.4 Menlo, Consolas, monospace; letter-spacing: 2px; color: var(--purple); margin-bottom: 8px; }
  .side h2 { margin: 26px 0 8px; font-size: 13px; letter-spacing: 1px; color: var(--purple); }
  .side p, .side li { color: #3F3F46; font-size: 13px; }
  .side ol, .side ul { padding-left: 18px; margin: 6px 0; }
  .side li { margin: 3px 0; }
  .tri { display: flex; height: 3px; width: 72px; margin: 14px 0 4px; }
  .tri i { flex: 1; } .tri i:nth-child(1){background:#18181B} .tri i:nth-child(2){background:#D90429} .tri i:nth-child(3){background:#F59E0B}
  .toc a { display: flex; gap: 8px; padding: 4px 6px; border-radius: 6px; text-decoration: none; color: var(--ink); font-size: 13px; }
  .toc a:hover { background: var(--paper); }
  .toc b { font: 700 11px/1.9 Menlo, Consolas, monospace; color: var(--purple); width: 22px; }
  .swatches { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .sw { border: 1px solid var(--line); border-radius: 6px; overflow: hidden; font: 10px/1.3 Menlo, Consolas, monospace; }
  .sw span { display: block; height: 26px; }
  .sw em { display: block; font-style: normal; padding: 3px 4px; color: #52525B; }
  table.spec { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.spec td { border-top: 1px solid var(--line); padding: 5px 4px; vertical-align: top; color: #3F3F46; }
  table.spec td:first-child { color: var(--ink); white-space: nowrap; }
  .note { background: #FFF7E6; border: 1px solid #F8D9A0; border-radius: 8px; padding: 10px 12px; }
  .note p { margin: 0 0 6px; font-size: 12.5px; } .note p:last-child { margin: 0; }
  .btn-all { margin-top: 14px; width: 100%; padding: 10px; border: 0; border-radius: 8px; background: var(--purple); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
  .btn-all:hover { background: #51065D; }
  main { padding: 36px 24px 80px; }
  .phone { position: relative; max-width: 480px; margin: 0 auto; background: #FFFFFF; border-radius: 28px; box-shadow: 0 1px 2px rgba(24,24,27,.06), 0 18px 48px rgba(52,16,80,.14); border: 1px solid #E7E3EE; }
  .wxbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px 10px; border-bottom: 1px solid #F0EEF3; color: #111; font-size: 15px; border-radius: 28px 28px 0 0; }
  .wxbar span { color: #999; font-size: 13px; }
  .wxhead { padding: 18px 16px 4px; }
  .wxhead h3 { margin: 0 0 10px; font-size: 22px; line-height: 1.4; font-weight: 700; color: rgba(0,0,0,.9); }
  .wxhead .meta { font-size: 15px; color: rgba(0,0,0,.3); } .wxhead .meta b { color: #576B95; font-weight: 400; margin-right: 8px; }
  /* 模拟公众号正文基础样式：模块必须自带字号颜色，才能在这里和后台都一致 */
  .wx { padding: 14px 16px 28px; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", Arial, sans-serif; font-size: 17px; line-height: 1.6; color: rgba(0,0,0,.9); letter-spacing: .034em; text-align: justify; word-wrap: break-word; overflow: hidden; }
  .wx * { max-width: 100% !important; box-sizing: border-box !important; word-wrap: break-word !important; }
  .wx img { height: auto !important; }
  .demo { position: relative; }
  .demo + .demo { margin-top: 0; }
  .demo:hover > .stage { outline: 1px dashed rgba(102,8,116,.45); outline-offset: 4px; }
  .rail { position: absolute; top: 0; left: calc(100% + 34px); width: 190px; display: flex; flex-direction: column; gap: 6px; }
  .rail .tag { font: 700 11px/1.4 Menlo, Consolas, monospace; color: var(--purple); letter-spacing: 1px; }
  .rail .tag small { display: block; font: 12px/1.4 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #52525B; letter-spacing: 0; }
  .copy { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border: 1px solid #D9D2E4; border-radius: 999px; background: #FFFFFF; color: var(--purple); font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 6px rgba(52,16,80,.08); white-space: nowrap; }
  .copy:hover { background: var(--purple); color: #FFFFFF; border-color: var(--purple); }
  .copy.done { background: #16794A; border-color: #16794A; color: #FFFFFF; }
  .toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(20px); opacity: 0; transition: .25s; background: #18181B; color: #FFFFFF; padding: 10px 16px; border-radius: 10px; font-size: 13px; pointer-events: none; z-index: 10; max-width: calc(100vw - 32px); }
  .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
  @media (max-width: 1260px) {
    /* 窄屏：按钮条放到模块上方，不压住模块内容 */
    .rail { position: static; width: auto; flex-direction: row; align-items: center; justify-content: space-between; margin: 14px 0 4px; padding: 4px 0; border-top: 1px dashed #E4E1EA; }
    .rail .tag small { display: none; }
    .copy { padding: 4px 10px; font-size: 12px; }
  }
  @media (max-width: 900px) {
    .layout { display: block; }
    .side { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); padding: 22px 16px; }
    main { padding: 18px 0 60px; }
    .phone { border-radius: 0; border-left: 0; border-right: 0; box-shadow: none; }
    .wxbar { border-radius: 0; }
  }
</style>
</head>
<body>
<div class="layout">
  <aside class="side">
    <div class="kicker">EEA × GERMANY · 2026</div>
    <h1>清华电机系赴德国海外社会实践支队 · 推文模板库</h1>
    <div class="tri"><i></i><i></i><i></i></div>
    <p>紫荆电磁 × 包豪斯精密工程图。9 类、15 个可单独复制的模块，全部为行内样式 + 内联 SVG。</p>
    <button class="btn-all" id="copy-all">📋 复制整篇示例到公众号</button>

    <h2>使用步骤</h2>
    <ol>
      <li>在右侧手机预览中找到模块，点「📋 复制此模块到公众号」。</li>
      <li>到公众号后台图文编辑器，光标放到目标位置，<b>Ctrl + V</b>。</li>
      <li>直接在后台改文字；点图片「替换」换成自己的照片（比例见下表）。</li>
      <li>嵌套：先粘贴「大型自适应文本框」，再把光标放进它的正文里，粘贴任意图片模块或引用卡片。</li>
      <li>图注可整段删空，图标会撑住高度，边框不会塌。</li>
    </ol>

    <h2>模块目录</h2>
    <nav class="toc">${MODULES.map((m) => `<a href="#${m.id}"><b>${m.no}</b>${m.name}</a>`).join('')}</nav>

    <h2>色彩规范</h2>
    <div class="swatches">
      ${[['#660874', '清华紫'], ['#1E3A8A', '电磁蓝'], ['#F8F7FA', '科技底'], ['#FFFFFF', '图纸白'], ['#18181B', '曜石黑'], ['#D90429', '帝国红'], ['#F59E0B', '莱茵金'], ['#888888', '图注灰']]
        .map(([c, n]) => `<div class="sw"><span style="background:${c}"></span><em>${n}<br>${c}</em></div>`).join('')}
    </div>

    <h2>字体规范</h2>
    <table class="spec">
      <tr><td>正文</td><td>14px · #000000 · 行高 1.85 · 字距 0.8px · 两端对齐</td></tr>
      <tr><td>图注</td><td>12px · #888888 · 行高 1.5</td></tr>
      <tr><td>刊头标题</td><td>20px 加粗 + 15px 紫色副题</td></tr>
      <tr><td>H1</td><td>19px 加粗 + 10px 等宽英文编号</td></tr>
      <tr><td>H2</td><td>15px 加粗 + 电路/齿轮图标</td></tr>
    </table>

    <h2>图片槽位与比例</h2>
    <table class="spec">${IMAGES.map(([a, b, c]) => `<tr><td>${a}</td><td>${b} · ${c}</td></tr>`).join('')}</table>
    <p style="font-size:12px;color:#6B6B76">占位图来自 Unsplash（Unsplash License），仅用于预览效果，正式发布请换成支队自己的照片。每张图的 alt 中也写了建议比例。</p>

    <h2>公众号兼容说明</h2>
    <div class="note">
      <p><b>尚未在公众号后台实测。</b>粘贴效果需要你登录后台验证，建议先在草稿里粘贴刊头和文本框两个最复杂的模块。</p>
      <p>没有使用 &lt;defs&gt;/&lt;pattern&gt;/渐变 id：公众号编辑器会清除 id 属性，依赖 id 引用的渐变、图案会整块失效。渐变改用容器的 CSS linear-gradient（失效时退回纯色），方格纸与刻度用虚线技巧逐线绘制。</p>
      <p>可编辑的文字（标题、正文、图注、铭牌信息）都在 HTML 里；SVG 里的英文丝印、坐标、路线站名属于装饰，后台无法直接改，需要在本文件 build.mjs 中修改后重新生成。</p>
      <p>风机叶片、相量、能量脉冲、指示灯使用 SVG 动画；若被过滤会静止显示，不影响排版。</p>
      <p>未使用 position:absolute、CSS Grid、class、&lt;style&gt;；多图全部用 flex。</p>
    </div>
  </aside>

  <main>
    <div class="phone">
      <div class="wxbar">‹ <b style="font-weight:600">公众号文章预览</b><span>···</span></div>
      <div class="wxhead">
        <h3>从二校门到勃兰登堡门｜EEA 赴德国海外社会实践</h3>
        <div class="meta"><b>清华电机 EEA</b>2026年7月</div>
      </div>
      <div class="wx" id="article">
${MODULES.map((m) => `        <div class="demo" id="${m.id}" data-name="${m.name}">
          <div class="rail"><div class="tag">${m.no} · ${m.en}<small>${m.name}</small></div><button class="copy" type="button">📋 复制此模块到公众号</button></div>
          <div class="stage">${m.html}</div>
        </div>`).join('\n')}
      </div>
    </div>
  </main>
</div>
<div class="toast" id="toast"></div>
<script>
  // 复制：优先 ClipboardItem（text/html），失败时用 copy 事件写入，二者都只写入模块本身的 HTML
  async function copyHtml(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })])
        return true
      }
    } catch (e) { /* 退回 execCommand */ }
    let ok = false
    const onCopy = (e) => { e.clipboardData.setData('text/html', html); e.clipboardData.setData('text/plain', text); e.preventDefault(); ok = true }
    document.addEventListener('copy', onCopy)
    try { document.execCommand('copy') } finally { document.removeEventListener('copy', onCopy) }
    return ok
  }
  const toast = (msg) => { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2600) }
  const stageHtml = (demo) => demo.querySelector('.stage').innerHTML.trim()
  document.querySelectorAll('.demo').forEach((demo) => {
    const btn = demo.querySelector('.copy')
    btn.addEventListener('click', async () => {
      const ok = await copyHtml(stageHtml(demo), demo.querySelector('.stage').innerText)
      toast(ok ? '已复制「' + demo.dataset.name + '」，到公众号后台 Ctrl+V 粘贴' : '复制失败：请换用 Chrome / Edge 打开本文件')
      if (ok) { btn.classList.add('done'); btn.textContent = '✓ 已复制'; setTimeout(() => { btn.classList.remove('done'); btn.textContent = '📋 复制此模块到公众号' }, 1800) }
    })
  })
  document.getElementById('copy-all').addEventListener('click', async () => {
    const demos = [...document.querySelectorAll('.demo')]
    const ok = await copyHtml(demos.map(stageHtml).join(''), document.getElementById('article').innerText)
    toast(ok ? '已复制整篇示例（' + demos.length + ' 个模块）' : '复制失败：请换用 Chrome / Edge 打开本文件')
  })
</script>
</body>
</html>
`

writeFileSync(OUT, page)
console.log(`wrote ${OUT} (${(page.length / 1024).toFixed(1)} KB, ${MODULES.length} modules)`)
