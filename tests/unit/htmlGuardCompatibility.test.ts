import { expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { guardHtml } from '../../src/core/sanitize'
import { compileBlock } from '../../src/core/compiler'
import { createBlock } from '../../src/core/blocks'
import { THEMES } from '../../src/core/themes'
const parse = (html: string) => new JSDOM(html, {url: 'https://fixture.invalid'}).window.document
const clean = (html: string) => parse(guardHtml(html))
it.each(['java&#x73;cript:alert(1)', 'java&#9;script:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)'])('rejects parsed link protocol %s', href => {
 expect(clean(`<a href="${href}">text</a>`).querySelector('a')?.hasAttribute('href')).toBe(false)
})
it('guards the real stored HTML compiler boundary', () => {
 const b = createBlock('html', {html: '<a href="java&#x73;cript:alert(1)">text</a>', label: 'fixture'})
 expect(parse(compileBlock(b, THEMES[0])).querySelector('a')?.hasAttribute('href')).toBe(false)
})
it.each(['href', 'xlink:href', 'style', 'onload', 'id'])('rejects dynamic mutation of %s', attr => {
 expect(clean(`<svg><rect><set attributeName="${attr}" to="java&#x73;cript:alert(1)"/></rect></svg>`).querySelector('set')).toBeNull()
})
it('keeps unique IDs, local paint/link references, click and replay timing', () => {
 const d = clean('<svg><defs><linearGradient id="paint"><stop stop-color="red"/></linearGradient></defs><rect id="start"/><g id="again"/><rect fill="url(#paint)"><animate attributeName="opacity" values="0;1" begin="start.click;again.click-0.2s" end="start.click+2s" dur="1s"/></rect><use href="#start"/></svg>')
 expect(d.getElementById('start')).not.toBeNull(); expect(d.querySelector('animate')?.getAttribute('begin')).toBe('start.click;again.click-0.2s')
 expect(d.querySelector('[fill]')?.getAttribute('fill')).toBe('url(#paint)');expect(d.querySelector('use')?.getAttribute('href')).toBe('#start')
})
it.each([['fill','red;#123456;rgb(1, 2, 3)'],['stroke','#fff;blue'],['stop-color','hsl(120, 50%, 50%);transparent'],['stroke-dashoffset','20;0'],['transform','0 0;10 20']])('keeps permitted %s animation', (attr, values) => {
 const tag=attr==='transform'?'animateTransform':'animate'
 const a=clean(`<svg><rect><${tag} attributeName="${attr}" values="${values}" type="translate" dur="1s"/></rect></svg>`).querySelector(tag)
 expect(a?.getAttribute('values')).toBe(values)
})
it.each(['url(javascript:alert(1));red','var(--secret);red','url(https://remote.test/p);blue'])('rejects active/nonliteral color animation %s', values => {
 expect(clean(`<svg><rect><animate attributeName="fill" values="${values}"/></rect></svg>`).querySelector('animate')).toBeNull()
})
it('removes external animation targets without retargeting them to the parent', () => {
 expect(clean('<svg><rect><animate href="https://remote.test/#x" attributeName="opacity" values="0;1"/></rect></svg>').querySelector('animate')).toBeNull()
})
it('retains explicit animation target only when it resolves uniquely inside the fragment', () => {
 const d=clean('<svg><rect id="safe_target"/><animate href="#safe_target" attributeName="opacity" values="0;1"/></svg>')
 expect(d.querySelector('animate')?.getAttribute('href')).toBe('#safe_target')
})
it('removes duplicate identities and their ambiguous references', () => {
 const d=clean('<svg><rect id="same"/><circle id="same"/><animate href="#same" attributeName="opacity" values="0;1"/><rect><set attributeName="opacity" to="1" begin="same.click"/></rect></svg>')
 expect(d.querySelectorAll('[id]')).toHaveLength(0);expect(d.querySelector('animate,set')).toBeNull()
})
it('checks references after clobber names are removed and does not trust markers', () => {
 const d=clean('<svg data-replay="trusted"><rect id="location"/><rect><animate attributeName="opacity" values="0;1" begin="location.click" onbegin="alert(1)"/></rect></svg>')
 expect(d.getElementById('location')).toBeNull();expect(d.querySelector('animate')).toBeNull();expect(d.querySelector('[onbegin]')).toBeNull()
})
it('keeps foreignObject Chinese layout while recursively filtering namespaces and handlers', () => {
 const d=clean('<svg viewBox="0 0 100 100"><foreignObject width="100" height="100"><p style="color:#333;font-size:14px">中文正文</p><svg><a xlink:href="java&#x73;cript:alert(1)"><text>bad</text></a></svg><img src="/media/a.png" onerror="alert(1)"></foreignObject></svg>')
 expect(d.querySelector('foreignObject p')?.textContent).toBe('中文正文');expect(d.querySelector('p')?.getAttribute('style')).toContain('font-size:14px')
 expect(d.querySelector('[onerror]')).toBeNull();expect(d.querySelector('a')?.hasAttribute('xlink:href')).toBe(false)
})
it('preserves ordinary safe external links and responsive inline dimensions', () => {
 const d=clean('<section style="max-width:100%;width:750px"><a id="chapter" href="https://example.com/a">safe</a></section>')
 expect(d.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a');expect(d.querySelector('section')?.getAttribute('style')).toContain('max-width:100%')
})

it('retains standard clobber protection for target as well as location', () => {
 for (const id of ['target','location']) {
 const d=clean(`<svg><rect id="${id}"/><animate href="#${id}" attributeName="opacity" values="0;1"/></svg>`)
 expect(d.getElementById(id)).toBeNull();expect(d.querySelector('animate')).toBeNull()
 }
})

it('removes dangling references when their target animation is itself rejected', () => {
 const d=clean('<svg><rect id="button"/><set id="bad_animation" attributeName="href" to="javascript:alert(1)"/><rect><animate attributeName="opacity" values="0;1" begin="bad_animation.end"/></rect></svg>')
 expect(d.querySelector('set,animate')).toBeNull()
})
it('retains valid syncbase timing between local animations', () => {
 const d=clean('<svg><rect><animate id="fade" attributeName="opacity" values="0;1" begin="0s"/><animate attributeName="x" values="0;1" begin="fade.end+0.1s"/></rect></svg>')
 expect(d.querySelectorAll('animate')).toHaveLength(2)
})

it('propagates rejected timing identities even when dependents precede the bad target', () => {
 const d=clean('<svg><rect><animate id="second" attributeName="opacity" values="0;1" begin="first.end"/><animate id="first" attributeName="opacity" values="0;1" begin="missing.click"/><animate attributeName="x" values="0;1" begin="second.end"/></rect></svg>')
 expect(d.querySelector('animate')).toBeNull()
})
it.each(['from','to','by','values'])('rejects URL-shaped numeric animation %s', name => {
 expect(clean(`<svg><rect><animate attributeName="x" ${name}="java&#x73;cript:alert(1)"/></rect></svg>`).querySelector('animate')).toBeNull()
})
it('retains valid motion paths and removes malformed executable motion', () => {
 expect(clean('<svg><rect><animateMotion path="M0 0 L10 20 Z" dur="1s"/></rect></svg>').querySelector('animateMotion')).not.toBeNull()
 expect(clean('<svg><rect><animateMotion path="javascript:alert(1)"/></rect></svg>').querySelector('animateMotion')).toBeNull()
})
it('does not permit a use element to fetch an external SVG document', () => {
 expect(clean('<svg><use href="https://remote.test/active.svg#x"/></svg>').querySelector('use')).toBeNull()
})
it('does not retarget conflicting href and xlink:href animation references', () => {
 expect(clean('<svg><rect id="valid_target"/><animate href="#valid_target" xlink:href="https://remote.test/#x" attributeName="opacity" values="0;1"/></svg>').querySelector('animate')).toBeNull()
})

it('clears ambiguous inline paint references while preserving other layout styles', () => {
 const d=clean('<svg><defs><linearGradient id="duplicate"/><linearGradient id="duplicate"/></defs><rect style="fill:url(#duplicate);stroke:blue;opacity:0.7"/></svg>')
 const rect=d.querySelector('rect')! as unknown as HTMLElement
 expect(rect.style.fill).toBe('');expect(rect.style.stroke).toBe('blue');expect(rect.style.opacity).toBe('0.7')
})
it('keeps valid inline paint references', () => {
 const d=clean('<svg><defs><linearGradient id="local_paint"/></defs><rect style="fill:url(#local_paint)"/></svg>')
 expect(d.querySelector('rect')?.getAttribute('style')).toContain('url(#local_paint)')
})

it('removes invalid paint URLs but preserves fallback colors and other filter references', () => {
 const d=clean('<svg><defs><linearGradient id="duplicate"/><linearGradient id="duplicate"/><filter id="safe_filter"/></defs><rect fill="url(#duplicate) red" filter="url(#removed) url(#safe_filter)" style="stroke:url(#duplicate) blue;filter:url(#removed) url(#safe_filter)"/></svg>')
 const rect=d.querySelector('rect')! as unknown as HTMLElement
 expect(rect.getAttribute('fill')).toBe('red');expect(rect.getAttribute('filter')).toBe('url(#safe_filter)')
 expect(rect.style.stroke).toBe('blue');expect(rect.style.filter).toMatch(/^url\(["']?#safe_filter["']?\)$/)
})
it('preserves valid paint fallback strings without rewriting them', () => {
 const d=clean('<svg><defs><linearGradient id="paint_valid"/></defs><rect fill="url(#paint_valid) red"/></svg>')
 expect(d.querySelector('rect')?.getAttribute('fill')).toBe('url(#paint_valid) red')
})
