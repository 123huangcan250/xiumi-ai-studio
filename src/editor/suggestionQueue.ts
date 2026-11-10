/** Memory-only cache: no article text is persisted or sent to another service. */
export class SuggestionQueue {
  private cache = new Map<string, string>()
  private pending: Promise<unknown> | null = null
  private lastStart = 0
  revision = 0
  clear() { this.cache.clear(); this.revision++ }
  constructor(private interval = 30_000) {}
  async get(key: string, fetch: () => Promise<{ suggestion: string }>, signal: AbortSignal): Promise<string> {
    while (this.pending) await this.pending.catch(() => undefined)
    if (signal.aborted) return ''
    if (this.cache.has(key)) return this.cache.get(key)!
    const delay = Math.max(0, this.lastStart + this.interval - Date.now())
    if (delay) {
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
        const timer = setTimeout(done, delay)
        signal.addEventListener('abort', done, { once: true })
      })
      return this.get(key, fetch, signal)
    }
    this.lastStart = Date.now()
    const revision = this.revision
    const request = fetch()
    this.pending = request
    try {
      const result = await request
      if (revision === this.revision) this.cache.set(key, result.suggestion)
      if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!)
      return result.suggestion
    } catch (error) {
      // No automatic retry loops for a failed context (including bad credentials).
      if (revision === this.revision) this.cache.set(key, '')
      throw error
    } finally {
      if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!)
      this.pending = null
    }
  }
}
export const instructionSuggestions = new SuggestionQueue()

/** Owned by App, not the conditionally mounted AI tab. */
export function listenForAiSettings(target: EventTarget): () => void {
  const clear = () => instructionSuggestions.clear()
  target.addEventListener('ai-settings-changed', clear)
  return () => target.removeEventListener('ai-settings-changed', clear)
}
