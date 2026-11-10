import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'

const contention = vi.hoisted(() => ({
  active: new Set<string>(),
  failNext: false,
  hold: null as { target: string; entered: () => void; release: Promise<void> } | null,
}))

// Model Windows' refusal to replace a destination while another rename is
// pending. Keep actual filesystem writes, replacement, and cleanup intact.
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    rename: async (from: string, to: string) => {
      if (contention.active.has(to)) throw Object.assign(new Error('Concurrent replacement'), { code: 'EPERM' })
      contention.active.add(to)
      try {
        if (contention.hold?.target === to) {
          contention.hold.entered()
          await contention.hold.release
        }
        await setImmediate()
        if (contention.failNext) {
          contention.failNext = false
          throw Object.assign(new Error('Replacement failed'), { code: 'EPERM' })
        }
        await fs.rename(from, to)
      } finally {
        contention.active.delete(to)
      }
    },
  }
})

import { writeJson } from '../../server/store'

const dirs: string[] = []
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'xiumi-store-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  contention.failNext = false
  contention.hold = null
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('atomic save queue', () => {
  it('serializes replacements of the same target in submission order', async () => {
    const dir = await tempDir()
    const file = join(dir, 'project.json')
    await writeFile(file, JSON.stringify({ id: -1 }))
    const results = await Promise.allSettled(Array.from({ length: 32 }, (_, id) => writeJson(file, { id })))
    expect(results.filter((result) => result.status === 'rejected')).toEqual([])
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ id: 31 })
    expect(await readdir(dir)).toEqual(['project.json'])
  })

  it('does not block another target behind a pending replacement', async () => {
    const dir = await tempDir()
    const first = join(dir, 'first.json')
    const second = join(dir, 'second.json')
    let markEntered!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => { markEntered = resolve })
    const released = new Promise<void>((resolve) => { release = resolve })
    contention.hold = { target: first, entered: markEntered, release: released }
    const firstSave = writeJson(first, { id: 1 })
    await entered
    const secondSave = writeJson(second, { id: 2 })
    try {
      await vi.waitFor(async () => {
        expect(JSON.parse(await readFile(second, 'utf8'))).toEqual({ id: 2 })
      })
    } finally {
      release()
      await Promise.all([firstSave, secondSave])
    }
    expect(JSON.parse(await readFile(first, 'utf8'))).toEqual({ id: 1 })
    expect((await readdir(dir)).sort()).toEqual(['first.json', 'second.json'])
  })

  it('lets already queued and later saves succeed after a replacement failure', async () => {
    const dir = await tempDir()
    const file = join(dir, 'project.json')
    await writeFile(file, JSON.stringify({ id: 0 }))
    contention.failNext = true
    const results = await Promise.allSettled([writeJson(file, { id: 1 }), writeJson(file, { id: 2 })])
    expect(results[0]).toMatchObject({ status: 'rejected', reason: { code: 'EPERM' } })
    expect(results[1]).toEqual({ status: 'fulfilled', value: undefined })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ id: 2 })
    await writeJson(file, { id: 3 })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ id: 3 })
    expect(await readdir(dir)).toEqual(['project.json'])
  })

  it('preserves the previous document and removes temporary files when replacement fails', async () => {
    const dir = await tempDir()
    const file = join(dir, 'project.json')
    await writeJson(file, { id: 0 })
    contention.failNext = true
    await expect(writeJson(file, { id: 1 })).rejects.toMatchObject({ code: 'EPERM' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ id: 0 })
    expect(await readdir(dir)).toEqual(['project.json'])
  })
})
