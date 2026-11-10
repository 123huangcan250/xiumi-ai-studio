import { describe, expect, it } from 'vitest'
import { clampZoom, wheelFactor, ZOOM_MAX, ZOOM_MIN } from '../../src/editor/zoom'
import { clampWidth, effectiveWidths, MIN_CENTER, PANEL_LIMITS } from '../../src/editor/Workspace'

describe('canvas zoom', () => {
  it('stays inside the allowed range and rounds to whole percents', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN)
    expect(clampZoom(9)).toBe(ZOOM_MAX)
    expect(clampZoom(1.0999)).toBe(1.1)
    expect(clampZoom(1 + 0.1 + 0.1)).toBe(1.2)
  })
  it('turns a wheel notch into a step and a trackpad nudge into a small change', () => {
    expect(wheelFactor(-100)).toBeCloseTo(1.1)
    expect(wheelFactor(100)).toBeCloseTo(1 / 1.1)
    expect(wheelFactor(-4)).toBeGreaterThan(1)
    expect(wheelFactor(-4)).toBeLessThan(1.05)
    expect(wheelFactor(0)).toBe(1)
  })
})

describe('side panel width', () => {
  it('keeps each side inside its limits and leaves room for the article', () => {
    expect(clampWidth('left', 50, 1600, 320)).toBe(PANEL_LIMITS.left[0])
    expect(clampWidth('left', 9999, 1600, 320)).toBe(PANEL_LIMITS.left[1])
    expect(clampWidth('right', 400, 1600, 260)).toBe(400)
    // 窗口窄：文章至少留 MIN_CENTER，侧栏让出来
    expect(clampWidth('left', 560, 1000, 320)).toBe(1000 - 320 - MIN_CENTER)
    // 空间再小也不会小于下限
    expect(clampWidth('right', 500, 700, 500)).toBe(PANEL_LIMITS.right[0])
  })
  it('only yields in what is shown, never rewrites the saved preference, and does nothing when unmeasured', () => {
    const saved = { left: 360, right: 432 }
    expect(effectiveWidths(saved, 1280)).toEqual({ left: 360, right: 432 })
    // 窗口只有 900 宽，两侧加起来放不下：左侧先让到下限，右侧用剩下的，文章留 MIN_CENTER
    const narrow = effectiveWidths(saved, 900, { left: 260, right: 320 })
    expect(narrow.left).toBe(PANEL_LIMITS.left[0])
    expect(narrow.right).toBe(900 - PANEL_LIMITS.left[0] - MIN_CENTER)
    expect(saved).toEqual({ left: 360, right: 432 })
    expect(effectiveWidths(saved, 0)).toBe(saved)
    expect(effectiveWidths({}, 500)).toEqual({})
  })
})
