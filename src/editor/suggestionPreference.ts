let enabled = true
let storageFailed = false
const key = 'xiumi:auto-input-suggestions'
export function readSuggestionPreference(): boolean {
  if (storageFailed) return enabled
  try { enabled = localStorage.getItem(key) !== 'off' } catch { /* Keep the page preference when storage is unavailable. */ }
  return enabled
}
export function saveSuggestionPreference(value: boolean): void {
  enabled = value
  try { localStorage.setItem(key, value ? 'on' : 'off') } catch { storageFailed = true; /* Still respected across panel remounts. */ }
}
