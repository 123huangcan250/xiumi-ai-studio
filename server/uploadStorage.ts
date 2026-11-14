import fs from 'node:fs'
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Request } from 'express'
import type { StorageEngine } from 'multer'
import { trackUpload, uploadContext } from './uploadGate'

type Budget = { bytes: number; error?: Error; pending: Set<(error: Error) => void>; onAbort?: () => void; onCancel?: () => void }
const storageError = (error: unknown): Error => {
  const cause = error instanceof Error ? error : new Error(String(error))
  return (cause as NodeJS.ErrnoException).code === 'ENOSPC' ? Object.assign(new Error('Temporary upload storage is full. Retry after freeing disk space.'), { status: 507 }) : cause
}
const interrupted = () => Object.assign(new Error('Upload was interrupted.'), { status: 400 })

/** Stream into owned random files; retain the existing buffer-based business API only after completion. */
export function boundedDiskStorage(maxBytes = 64 * 1024 * 1024, tempRoot = tmpdir()): StorageEngine {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Invalid upload budget')
  const requests = new WeakMap<Request, Budget>()
  return {
    _handleFile(req, file, callback) {
      let budget = requests.get(req)
      if (!budget) { budget = { bytes: 0, pending: new Set() }; requests.set(req, budget) }
      const state = budget, context = uploadContext(req), controller = new AbortController()
      const fail = (error: Error) => controller.abort(error)
      const failAll = (error: Error) => { state.error ??= storageError(error); for (const pending of state.pending) pending(state.error) }
      // Keep a listener after completion: a late stream error must not crash Node.
      file.stream.on('error', failAll)
      if (state.error || context.controller.signal.aborted) { callback(state.error ?? context.controller.signal.reason); file.stream.resume(); return }
      const done = trackUpload(req)
      state.pending.add(fail)
      const onLimit = () => failAll(Object.assign(new Error('Single upload exceeds the file size limit.'), { status: 413 }))
      if (!state.onAbort) {
        state.onAbort = () => failAll(interrupted())
        state.onCancel = () => failAll(context.controller.signal.reason)
        req.once('aborted', state.onAbort)
        context.controller.signal.addEventListener('abort', state.onCancel, { once: true })
      }
      file.stream.once('limit', onLimit)
      let size = 0
      const count = (chunk: Buffer) => {
        if (controller.signal.aborted) return
        if (chunk.length > maxBytes - state.bytes) return failAll(Object.assign(new Error(`Total upload exceeds the ${maxBytes} byte request budget; upload fewer files at once.`), { status: 413 }))
        state.bytes += chunk.length; size += chunk.length
      }
      void (async () => {
        let directory: string | undefined, path: string | undefined, writer: fs.WriteStream | undefined, closed: Promise<void> | undefined
        let buffer: Buffer | undefined, error: Error | undefined
        try {
          directory = await mkdtemp(join(tempRoot, 'xiumi-upload-'))
          path = join(directory, 'content') // Never use the user-supplied filename for a disk path.
          controller.signal.throwIfAborted()
          writer = fs.createWriteStream(path, { flags: 'wx', mode: 0o600 })
          const output = writer
          closed = new Promise(resolve => output.once('close', resolve))
          await new Promise<void>((resolve, reject) => {
            const abort = () => { file.stream.unpipe(output); output.destroy(); reject(controller.signal.reason) }
            controller.signal.addEventListener('abort', abort, { once: true })
            output.once('error', failAll)
            output.once('finish', () => { controller.signal.removeEventListener('abort', abort); resolve() })
            file.stream.on('data', count)
            file.stream.pipe(output)
          })
          await closed
          controller.signal.throwIfAborted()
          buffer = await readFile(path, { signal: controller.signal })
          controller.signal.throwIfAborted()
        } catch (cause) { error = storageError(controller.signal.aborted ? controller.signal.reason : cause); failAll(error) }
        finally {
          file.stream.off('data', count); file.stream.off('limit', onLimit)
          state.pending.delete(fail)
          if (!state.pending.size) {
            if (state.onAbort) req.off('aborted', state.onAbort)
            if (state.onCancel) context.controller.signal.removeEventListener('abort', state.onCancel)
            state.onAbort = undefined; state.onCancel = undefined
          }
          if (writer) { file.stream.unpipe(writer); writer.destroy(); await closed }
          try {
            if (path) await unlink(path).catch(cause => { if (cause.code !== 'ENOENT') throw cause })
            if (directory) await rmdir(directory)
          } catch (cause) { error ??= storageError(cause) }
          done()
          if (error) { file.stream.resume(); callback(error) }
          else callback(null, { buffer, size })
        }
      })()
    },
    _removeFile(_req, file, callback) { delete (file as Partial<Express.Multer.File>).buffer; callback(null) },
  }
}
