import { fromBuffer, type Entry, type ZipFile } from 'yauzl'
import type { Readable } from 'node:stream'

export const DOCX_BUDGET = { entries: 2048, entryBytes: 32 * 1024 * 1024, totalBytes: 128 * 1024 * 1024 } as const
export type DocxBudget = { entries: number; entryBytes: number; totalBytes: number }
const exceeded = (detail: string) => Object.assign(new Error(`Word archive exceeds the ${detail} safety budget. Split the document or reduce embedded image dimensions.`), { status: 413 })

/** Validate actual decompressed bytes before Mammoth can allocate XML/images or write assets. */
export async function validateDocxArchive(buffer: Buffer, budget: DocxBudget = DOCX_BUDGET): Promise<void> {
  if (Object.values(budget).some(n => !Number.isSafeInteger(n) || n < 1)) throw new RangeError('Invalid Word archive budget')
  const zip = await new Promise<ZipFile>((resolve, reject) => fromBuffer(buffer, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (error, file) => error ? reject(error) : resolve(file)))
  let active: Readable | undefined, total = 0, count = 0
  const names = new Set<string>()
  try {
    await new Promise<void>((resolve, reject) => {
      let stopped = false
      const fail = (error: unknown) => { if (stopped) return; stopped = true; active?.destroy(); reject(error) }
      zip.on('error', fail)
      zip.once('end', () => { stopped = true; resolve() })
      zip.on('entry', (entry: Entry) => {
        if (stopped) return
        if (++count > budget.entries) return fail(exceeded(`${budget.entries}-entry`))
        if (names.has(entry.fileName)) return fail(new Error('Invalid zip: duplicate entry name'))
        names.add(entry.fileName)
        zip.openReadStream(entry, (error, stream) => {
          if (error) return fail(error)
          if (stopped) { stream.destroy(); return }
          active = stream
          let bytes = 0
          stream.on('error', fail)
          stream.on('data', (chunk: Buffer) => {
            if (stopped) return
            bytes += chunk.length; total += chunk.length
            if (bytes > budget.entryBytes) fail(exceeded(`${budget.entryBytes}-byte per-entry`))
            else if (total > budget.totalBytes) fail(exceeded(`${budget.totalBytes}-byte expanded total`))
          })
          stream.once('end', () => { active = undefined; if (!stopped) zip.readEntry() })
        })
      })
      zip.readEntry()
    })
  } finally { active?.destroy(); zip.close() }
}
