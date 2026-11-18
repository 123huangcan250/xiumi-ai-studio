import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'

function editor(dark = false) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <aside class="panel left">
      <div class="list-row current"><button class="grow" id="current">当前项目</button></div>
      <div class="list-row"><button class="grow" id="other">另一个项目</button></div>
    </aside>
    <main class="canvas-wrap">
      <div class="article">
        <div class="block selected editing" data-block-id="block" id="selected">
          <div class="block-html">
            <div class="block selected" data-block-id="authored" id="authored" style="outline-width: 1px; outline-style: solid; outline-color: black">原文<div class="block-toolbar" id="authored-toolbar"><span>原样</span></div></div>
          </div>
        </div>
        <div class="block selected" data-block-id="parent">
          <div class="box-body"><div class="block selected" data-block-id="nested" id="nested">框内文字</div></div>
        </div>
        <div class="block" data-block-id="idle" id="idle">未选模块</div>
      </div>
      <div class="image-resize-overlay" id="photo"></div>
    </main>
  </body></html>`)
  if (dark) {
    dom.window.document.documentElement.dataset.colorMode = 'dark'
    dom.window.document.documentElement.dataset.uiTheme = 'mono-dark'
  }
  const entrySheets = Array.from(readFileSync('src/main.tsx', 'utf8').matchAll(/^import '\.\/(.+?\.css)'$/gm), ([, path]) => `src/${path}`)
  expect(entrySheets).toContain('src/styles.css')
  for (const path of ['src/editor/ImageResize.css', ...entrySheets]) {
    const style = dom.window.document.createElement('style')
    style.textContent = readFileSync(path, 'utf8')
    dom.window.document.head.append(style)
  }
  return dom
}

it.each([false, true])('keeps a blue module perimeter when editing and nesting without restyling the article (dark=%s)', dark => {
  const dom = editor(dark)
  try {
    const style = (id: string) => dom.window.getComputedStyle(dom.window.document.getElementById(id)!)
    expect(style('selected').outlineStyle).toBe('solid')
    expect(style('selected').outlineColor).toBe('rgb(37, 99, 235)')
    expect(style('selected').outlineWidth).toBe('2px')
    expect(style('nested').outlineColor).toBe('rgb(37, 99, 235)')
    expect(style('idle').outlineColor).not.toBe('rgb(37, 99, 235)')
    expect(style('selected').borderWidth).toBe(style('idle').borderWidth)
    expect(style('authored').outlineColor).toBe('rgb(0, 0, 0)')
    expect(style('authored-toolbar').fontFamily).not.toContain('Noto Sans SC Variable')
  } finally { dom.window.close() }
})

it.each([false, true])('draws the current project and resize-target perimeters in blue (dark=%s)', dark => {
  const dom = editor(dark)
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

it.each(['mono-light', 'mono-dark'])('keeps the destructive color specific to editor controls (%s)', theme => {
  const dom = editor()
  try {
    const doc = dom.window.document
    doc.documentElement.dataset.uiTheme = theme
    doc.body.insertAdjacentHTML('beforeend', `<main class="workspace"><aside class="panel right">
      <button id="delete" class="danger">删除所选模块</button><button id="cancel">取消选择</button>
      <div class="comp-preview"><button id="authored-delete" class="danger">原文</button></div>
    </aside></main>`)
    const style = (id: string) => dom.window.getComputedStyle(doc.getElementById(id)!)
    expect(style('delete').color).toBe('var(--ui-danger)')
    expect(style('cancel').color).toBe('var(--ui-text)')
    expect(style('authored-delete').color).toBe('var(--danger)')
  } finally { dom.window.close() }
})
