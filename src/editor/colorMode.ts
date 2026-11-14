export type ColorModePreference = 'auto' | 'light' | 'dark'
export type ResolvedColorMode = 'light' | 'dark'

export const COLOR_MODE_KEY = 'xiumi-color-mode'

export function parseColorMode(value: unknown): ColorModePreference {
  return value === 'light' || value === 'dark' ? value : 'auto'
}

/** Use the device's current local wall clock, including its current timezone/DST. */
export function resolveColorMode(preference: ColorModePreference, now = new Date()): ResolvedColorMode {
  if (preference !== 'auto') return preference
  const hour = now.getHours()
  return hour >= 7 && hour < 19 ? 'light' : 'dark'
}

export function readColorMode(): ColorModePreference {
  try {
    return parseColorMode(window.localStorage.getItem(COLOR_MODE_KEY))
  } catch {
    return 'auto'
  }
}

export function saveColorMode(preference: ColorModePreference): void {
  try {
    window.localStorage.setItem(COLOR_MODE_KEY, preference)
  } catch {
    // Private browsing, disabled storage and a full quota still permit this session's choice.
  }
}
