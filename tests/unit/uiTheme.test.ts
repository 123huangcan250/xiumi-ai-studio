import { describe, expect, it } from 'vitest'
import { readUiTheme, resolveUiTheme } from '../../src/editor/uiTheme'

describe('editor interface themes', () => {
  it('defaults to upstream, rejects unknown saved themes, and keeps an explicit choice', () => {
    expect(readUiTheme(() => null)).toBe('upstream')
    expect(readUiTheme(key => key === 'xiumi-ui-theme' ? 'unknown' : 'dark')).toBe('upstream')
    expect(readUiTheme(key => key === 'xiumi-ui-theme' ? 'mono-light' : 'dark')).toBe('mono-light')
  })
  it('migrates only old dark and auto preferences without changing upstream light', () => {
    expect(readUiTheme(key => key === 'xiumi-color-mode' ? 'dark' : null)).toBe('mono-dark')
    expect(readUiTheme(key => key === 'xiumi-color-mode' ? 'light' : null)).toBe('upstream')
    expect(readUiTheme(key => key === 'xiumi-color-mode' ? 'auto' : null)).toBe('mono-auto')
    expect(readUiTheme(() => { throw new Error('storage unavailable') })).toBe('upstream')
  })
  it('resolves automated monochrome by device local day/night time', () => {
    expect(resolveUiTheme('mono-auto', new Date(2026, 10, 16, 6, 59))).toBe('mono-dark')
    expect(resolveUiTheme('mono-auto', new Date(2026, 10, 16, 7))).toBe('mono-light')
    expect(resolveUiTheme('mono-auto', new Date(2026, 10, 16, 19))).toBe('mono-dark')
    expect(resolveUiTheme('upstream', new Date(2026, 10, 16, 22))).toBe('upstream')
  })
})
