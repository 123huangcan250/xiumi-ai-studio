// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, expect, it } from 'vitest'

afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; delete document.documentElement.dataset.colorMode })
it.each(['light', 'dark'])('keeps picker touch targets at least 44px in %s actual styles', mode => {
  document.documentElement.dataset.colorMode = mode
  const imports = [...readFileSync('src/main.tsx', 'utf8').matchAll(/import ['"]\.\/(.*?\.css)['"]/g)]
  expect(imports.length).toBeGreaterThan(0)
  for (const [, file] of imports) {
    const style = document.createElement('style')
    style.textContent = readFileSync(`src/${file}`, 'utf8')
    document.head.append(style)
  }
  document.body.innerHTML = '<div class="ai-settings"><div class="model-picker"><button class="model-picker-trigger">模型</button><div class="model-picker-option" role="option">模型 A</div></div></div>'
  for (const selector of ['.model-picker-trigger', '.model-picker-option']) {
    expect(parseFloat(getComputedStyle(document.querySelector(selector)!).minHeight)).toBeGreaterThanOrEqual(44)
  }
})
