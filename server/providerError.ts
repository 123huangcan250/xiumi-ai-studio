/** Provider failures may reflect request credentials. Never retain their raw stack/cause. */
export function providerErrorText(value: unknown, apiKey: string): string {
  let text = String(value ?? '')
  if (!apiKey) return text
  const variants = new Set([apiKey, JSON.stringify(apiKey).slice(1, -1)])
  try { variants.add(encodeURIComponent(apiKey)) } catch { /* Malformed Unicode: raw/JSON forms still protected. */ }
  for (const secret of [...variants].sort((a, b) => b.length - a.length)) text = text.split(secret).join('***')
  return text
}

export function safeProviderError(value: unknown, apiKey: string): Error & { status?: number; code?: string | number } {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const error = new Error(providerErrorText(source.message ?? value, apiKey)) as Error & { status?: number; code?: string | number }
  if (typeof source.name === 'string') error.name = providerErrorText(source.name, apiKey)
  if (typeof source.status === 'number' && Number.isInteger(source.status) && source.status >= 400 && source.status <= 599) error.status = source.status
  if (typeof source.code === 'string') error.code = providerErrorText(source.code, apiKey)
  else if (typeof source.code === 'number' && Number.isFinite(source.code)) error.code = source.code
  return error
}
