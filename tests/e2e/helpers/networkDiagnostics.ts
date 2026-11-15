import type { Page, Request } from '@playwright/test'

const paths = new Set(['/api/components', '/api/ai/place-photos', '/api/ai/copywrite', '/api/ai/design', '/api/ai/status'])
export function safeFailure(request: Pick<Request, 'url' | 'method' | 'failure'>, inFlight: number) {
  let url: URL
  try { url = new URL(request.url()) } catch { return null }
  if (url.hostname !== '127.0.0.1' || !paths.has(url.pathname)) return null
  const method = request.method()
  const error = request.failure()?.errorText ?? ''
  return { path: url.pathname, method: ['GET', 'POST', 'PUT', 'DELETE'].includes(method) ? method : 'OTHER',
    error: /^net::ERR_[A-Z0-9_]+$/.test(error) ? error : 'unavailable', inFlight }
}

/** Bounded failure-only metadata; never record URLs, bodies, headers or request objects. */
export function captureNetworkFailures(page: Page) {
  const pending = new Set<Request>()
  const failures: NonNullable<ReturnType<typeof safeFailure>>[] = []
  const started = (request: Request) => pending.add(request)
  const finished = (request: Request) => { pending.delete(request) }
  const failed = (request: Request) => {
    const entry = safeFailure(request, pending.size)
    if (entry && failures.length < 20) failures.push(entry)
    finished(request)
  }
  page.on('request', started); page.on('requestfinished', finished); page.on('requestfailed', failed)
  return () => {
    page.off('request', started); page.off('requestfinished', finished); page.off('requestfailed', failed)
    pending.clear()
    return { schema: 1, failures }
  }
}
