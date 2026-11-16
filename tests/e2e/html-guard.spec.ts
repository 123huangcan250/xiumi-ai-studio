import { test, expect } from '@playwright/test'
import { build } from 'esbuild'

let browserGuard: string
test.beforeAll(async () => {
  const result = await build({
    stdin: { contents: "import { guardHtml } from './src/core/sanitize'; globalThis.__guardFixture = guardHtml", resolveDir: process.cwd() },
    bundle: true, platform: 'browser', format: 'iife', write: false,
  })
  browserGuard = result.outputFiles[0].text
})

test('HTML guard uses the browser export and preserves real SVG click/color animation', async ({ page }) => {
  await page.goto('/')
  await page.addScriptTag({ content: browserGuard })
  const result = await page.evaluate(async () => {
    const guardHtml = (globalThis as unknown as { __guardFixture: (html: string) => string }).__guardFixture
    const host = document.createElement('section')
    host.innerHTML = guardHtml('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><rect id="start_guard" width="100" height="100" fill="red"><animate attributeName="fill" values="red;blue" begin="start_guard.click" dur="1s" fill="freeze"/></rect><foreignObject y="20" width="100" height="60"><p style="font-size:14px">中文正文</p></foreignObject></svg>')
    document.body.append(host)
    const svg = host.querySelector('svg')!
    const rect = host.querySelector('rect')!
    svg.pauseAnimations(); svg.setCurrentTime(0)
    rect.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    svg.setCurrentTime(2)
    const result = { color: getComputedStyle(rect).fill, text: host.querySelector('foreignObject p')?.textContent, id: rect.id, animation: !!host.querySelector('animate') }
    host.remove()
    return result
  })
  expect(result).toEqual({ color: 'rgb(0, 0, 255)', text: '中文正文', id: 'start_guard', animation: true })
})

test('browser rendering cannot execute reflected HTML or SMIL URL payloads', async ({ page }) => {
  await page.goto('/')
  await page.addScriptTag({ content: browserGuard })
  const result = await page.evaluate(async () => {
    const guardHtml = (globalThis as unknown as { __guardFixture: (html: string) => string }).__guardFixture
    const host = document.createElement('section')
    host.innerHTML = guardHtml('<a href="java&#x73;cript:alert(1)">link</a><svg><foreignObject><img src="/missing-test-image" onerror="alert(1)"></foreignObject><set attributeName="href" to="javascript:alert(1)"/></svg>')
    document.body.append(host)
    const result = { href: host.querySelector('a')?.getAttribute('href'), handlers: host.querySelectorAll('[onerror]').length, mutation: !!host.querySelector('set') }
    host.remove()
    return result
  })
  expect(result).toEqual({ href: null, handlers: 0, mutation: false })
})


test('actual saved article uses the production canvas guard and preserves safe click animation', async ({ page }) => {
  const now = Date.now(), id = `guard-article-${now}`
  const html = '<section><a href="java&#x73;cript:void(0)">unsafe-link</a><svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect id="article_guard_rect" width="100" height="100" fill="red"><animate attributeName="fill" values="red;blue" begin="article_guard_rect.click" dur="1s" fill="freeze"/></rect><foreignObject y="20" width="100" height="60"><p>正文中文</p></foreignObject></svg></section>'
  const result = await page.request.put(`/api/projects/${id}`, { data: { id, title: 'Guard production article', author: '', digest: '', themeId: 'minimal-magazine', createdAt: now, updatedAt: now, blocks: [{ id: 'guard-article', type: 'html', props: { html, label: 'Guard article' } }] } })
  expect(result.ok(), await result.text()).toBe(true)
  await page.goto('/')
  await expect(page.locator('.title-input')).toHaveValue('Guard production article')
  const block = page.locator('[data-block-id="guard-article"] .block-html').first()
  await expect(block.locator('a')).not.toHaveAttribute('href')
  await expect(block.locator('foreignObject p')).toHaveText('正文中文')
  const color = await block.locator('svg').evaluate((element) => {
    const svg = element as SVGSVGElement, rect = svg.querySelector('rect')!
    svg.pauseAnimations(); svg.setCurrentTime(0)
    rect.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    svg.setCurrentTime(2)
    return getComputedStyle(rect).fill
  })
  expect(color).toBe('rgb(0, 0, 255)')
  await page.reload()
  await expect(block.locator('a')).not.toHaveAttribute('href')
})
