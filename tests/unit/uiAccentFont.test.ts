// 界面配色与界面字体：只存取偏好、生成界面变量，不涉及文章内容
import { describe, expect, it } from 'vitest'
import {
  accentVars, parseUiAccent, parseUiFont, readUiAccent, readUiFont, UI_ACCENTS, UI_ACCENT_KEY, UI_FONTS, UI_FONT_KEY, uiFontStack,
} from '../../src/editor/uiTheme'

const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

describe('界面配色', () => {
  it('包含 Sakura 樱花粉，默认配色不覆盖任何变量', () => {
    expect(UI_ACCENTS.map(a => a.id)).toContain('sakura')
    expect(UI_ACCENTS.find(a => a.id === 'sakura')!.name).toBe('Sakura 樱花粉')
    expect(UI_ACCENTS[0]!.id).toBe('default')
    expect(accentVars('default', false)).toBeNull()
    expect(accentVars('default', true)).toBeNull()
  })

  it('读取偏好：没存过、存了未知值、存储不可用，都回到默认', () => {
    expect(readUiAccent(() => null)).toBe('default')
    expect(readUiAccent(key => (key === UI_ACCENT_KEY ? 'neon' : null))).toBe('default')
    expect(readUiAccent(key => (key === UI_ACCENT_KEY ? 'sakura' : null))).toBe('sakura')
    expect(readUiAccent(() => { throw new Error('storage unavailable') })).toBe('default')
    expect(parseUiAccent(undefined)).toBe('default')
  })

  it('浅色与深色各给出一组变量，深色不带页面底色', () => {
    const light = accentVars('sakura', false)!
    const dark = accentVars('sakura', true)!
    expect(light['--ui-acc']).not.toBe(dark['--ui-acc'])
    expect(light['--ui-acc-on']).toBe('#ffffff')
    expect(dark['--ui-acc-on']).toBe('#181816')
    expect(light['--ui-acc-bg']).toBeTruthy()
    expect(dark['--ui-acc-bg']).toBeUndefined()
  })

  it('每种配色都看得清：按钮白字、选中态主色字、深色界面的字都不低于 4.5:1', () => {
    for (const a of UI_ACCENTS.filter(x => x.id !== 'default')) {
      const where = a.name
      expect(contrast('#ffffff', a.light.brand), `${where} 白字按钮`).toBeGreaterThanOrEqual(4.5)
      expect(contrast('#ffffff', a.light.hover), `${where} 悬停按钮`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(a.light.brand, a.light.soft), `${where} 选中态`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(a.light.brand, '#ffffff'), `${where} 链接`).toBeGreaterThanOrEqual(4.5)
      expect(contrast('#181816', a.dark.brand), `${where} 深色按钮`).toBeGreaterThanOrEqual(4.5)
      expect(contrast('#181816', a.dark.hover), `${where} 深色悬停`).toBeGreaterThanOrEqual(4.5)
      for (const surface of ['#1b1b1a', '#30302e', a.dark.soft]) {
        expect(contrast(a.dark.brand, surface), `${where} 深色字 on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('配色 id 不重复，色值都是 6 位十六进制', () => {
    expect(new Set(UI_ACCENTS.map(a => a.id)).size).toBe(UI_ACCENTS.length)
    for (const a of UI_ACCENTS) for (const v of [...Object.values(a.light), ...Object.values(a.dark)]) expect(v).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('界面字体', () => {
  it('默认字体即上游字体栈，其余各有备选', () => {
    expect(UI_FONTS[0]!.id).toBe('default')
    expect(uiFontStack('default')).toContain('Microsoft YaHei')
    for (const f of UI_FONTS) expect(f.stack.split(',').length, f.name).toBeGreaterThanOrEqual(3)
    expect(new Set(UI_FONTS.map(f => f.id)).size).toBe(UI_FONTS.length)
  })

  it('读取偏好：没存过、未知值、存储不可用，都回到默认', () => {
    expect(readUiFont(() => null)).toBe('default')
    expect(readUiFont(key => (key === UI_FONT_KEY ? 'comic' : null))).toBe('default')
    expect(readUiFont(key => (key === UI_FONT_KEY ? 'serif' : null))).toBe('serif')
    expect(readUiFont(() => { throw new Error('storage unavailable') })).toBe('default')
    expect(parseUiFont(42)).toBe('default')
  })

  it('已装的思源黑体、思源宋体字体栈引用的字体名与随程序打包的一致', () => {
    expect(uiFontStack('sans')).toContain("'Noto Sans SC Variable'")
    expect(uiFontStack('serif')).toContain("'Noto Serif SC Variable'")
  })
})
