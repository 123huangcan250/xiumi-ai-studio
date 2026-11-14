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
