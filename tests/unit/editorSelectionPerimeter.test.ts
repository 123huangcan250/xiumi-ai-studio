import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'

function editor() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <aside class="panel left">
      <div class="list-row current"><button class="grow" id="current">当前项目</button></div>
      <div class="list-row"><button class="grow" id="other">另一个项目</button></div>
    </aside>
    <main class="canvas-wrap">
      <div class="article">
        <div class="block selected editing" data-block-id="block" id="selected">
          <div class="block-html">
            <div class="block selected" data-block-id="authored" id="authored" style="outline-width: 1px; outline-style: solid; outline-color: black">原文</div>
          </div>
        </div>
        <div class="block" data-block-id="idle" id="idle">未选模块</div>
      </div>
      <div class="image-resize-overlay" id="photo"></div>
    </main>
  </body></html>`)
  for (const path of ['src/styles.css', 'src/editor/ImageResize.css']) {
    const style = dom.window.document.createElement('style')
    style.textContent = readFileSync(path, 'utf8')
    dom.window.document.head.append(style)
  }
  return dom
}

it('keeps a blue module perimeter when editing without restyling the article', () => {
  const dom = editor()
  try {
    const style = (id: string) => dom.window.getComputedStyle(dom.window.document.getElementById(id)!)
    expect(style('selected').outlineStyle).toBe('solid')
    expect(style('selected').outlineColor).toBe('rgb(37, 99, 235)')
    expect(style('selected').outlineWidth).toBe('2px')
    expect(style('idle').outlineColor).not.toBe('rgb(37, 99, 235)')
    expect(style('selected').borderWidth).toBe(style('idle').borderWidth)
    expect(style('authored').outlineColor).toBe('rgb(0, 0, 0)')
  } finally { dom.window.close() }
})

it('draws the current project and resize-target perimeters in blue, without highlighting other projects', () => {
  const dom = editor()
  try {
    const style = (id: string) => dom.window.getComputedStyle(dom.window.document.getElementById(id)!)
    expect(style('current').outlineStyle).toBe('solid')
    expect(style('current').outlineColor).toBe('rgb(37, 99, 235)')
    expect(style('current').borderWidth).toBe(style('other').borderWidth)
    expect(style('other').outlineColor).not.toBe('rgb(37, 99, 235)')
    expect(style('photo').borderTopColor).toBe('rgb(37, 99, 235)')
    expect(style('photo').borderTopWidth).toBe('2px')
    expect(style('photo').boxSizing).toBe('border-box')
  } finally { dom.window.close() }
})
