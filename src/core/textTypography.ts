/** Document typography, deliberately separate from application UI fonts. */
export const TEXT_FONTS = [
  { label: '无衬线 / 黑体', value: 'Noto Sans SC Variable, Noto Sans SC, Microsoft YaHei, sans-serif' },
  { label: '宋体', value: 'Noto Serif SC Variable, Noto Serif SC, SimSun, serif' },
  { label: '楷体', value: 'KaiTi, STKaiti, serif' },
  { label: '仿宋', value: 'FangSong, STFangsong, serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
  { label: '等宽', value: 'Consolas, Courier New, monospace' },
] as const
export const TEXT_SIZES = [12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48]
/** Restricted family-name syntax, not a guarantee that the font is installed or embedded. */
export function safeTextFont(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 180 || /[\r\n\t]/.test(value)) return undefined
  const names = value.split(',').map(name => name.trim())
  const valid = names.every(name => {
    if (!name) return false
    const quote = name[0]
    if (quote === "'" || quote === '"') {
      return name.at(-1) === quote && /^[\p{L}\p{N} -]+$/u.test(name.slice(1, -1)) && !!name.slice(1, -1).trim()
    }
    return /^[\p{L}-][\p{L}\p{N} -]*$/u.test(name)
  })
  return valid ? value : undefined
}
export function safeTextSize(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 20 || !/^\d+(?:\.\d+)?px$/.test(value)) return undefined
  const size = Number.parseFloat(value)
  return size >= 8 && size <= 96 ? `${size}px` : undefined
}
