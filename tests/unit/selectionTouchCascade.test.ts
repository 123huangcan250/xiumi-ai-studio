import { readFileSync, existsSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'

it.each(['light', 'dark'])('keeps selection controls at 44px through the actual %s stylesheet cascade', mode => {
  const dom = new JSDOM(`<html data-color-mode="${mode}"><head></head><body><div class="canvas-wrap"><div class="selection-bar"><button>选择多个</button></div></div></body></html>`)
  try {
    const main = readFileSync('src/main.tsx', 'utf8')
    for (const match of main.matchAll(/import ['"]\.\/(.*?\.css)['"]/g)) {
      const path = `src/${match[1]}`
      expect(existsSync(path)).toBe(true)
      const style = dom.window.document.createElement('style')
      style.textContent = readFileSync(path, 'utf8')
      dom.window.document.head.append(style)
    }
    expect(dom.window.getComputedStyle(dom.window.document.querySelector('button')!).minHeight).toBe('44px')
  } finally { dom.window.close() }
})

it('requires dark mode only for the explicit responsive combination, retaining narrow bbox checks', () => {
  for (const file of ['inline-review.spec.ts', 'multi-selection.spec.ts']) {
    const source = readFileSync(`tests/e2e/${file}`, 'utf8')
    const darkAssertions = source.split('\n').filter(line => line.includes("toHaveAttribute('data-color-mode','dark')"))
    expect(darkAssertions).toHaveLength(1)
    expect(darkAssertions[0]).toContain("if (process.env.XIUMI_RESPONSIVE_COMBINATION === '1')")
    expect(source).toContain('boundingBox())!.height).toBeGreaterThanOrEqual(44)')
  }
})
