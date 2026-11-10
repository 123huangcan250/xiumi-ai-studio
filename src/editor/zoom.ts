// 文章画布的缩放范围和滚轮换算（只缩放中间的文章，不缩放整个界面）
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))

/** 滚轮一格或触控板的一小段对应的缩放倍数 */
export const wheelFactor = (deltaY: number) => (Math.abs(deltaY) >= 50 ? (deltaY < 0 ? 1.1 : 1 / 1.1) : Math.exp(-deltaY * 0.004))
