export const MAX_INPUT_PIXELS = 64_000_000
const MAX_WAITING_IMAGES = 64
let queued = 0
let tail: Promise<unknown> = Promise.resolve()
/** One active Sharp pipeline, at most 64 waiting; every caller shares this gate. */
export function withImageBudget<T>(work: () => Promise<T>): Promise<T> {
  if (queued >= MAX_WAITING_IMAGES + 1) return Promise.reject(Object.assign(new Error('Image processing queue is full. Retry with fewer images.'), { status: 429 }))
  queued++
  const result = tail.then(work).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes('Input image exceeds pixel limit')) throw Object.assign(new Error('Image exceeds the 64-megapixel input limit. Reduce its dimensions and retry.'), { status: 413 })
    throw error
  }).finally(() => { queued-- })
  tail = result.catch(() => {})
  return result
}
