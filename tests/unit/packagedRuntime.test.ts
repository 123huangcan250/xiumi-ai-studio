import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('bundles a runtime satisfying the documented minimum dependency version', () => {
  const source = readFileSync('scripts/package-win.ts', 'utf8')
  const version = source.match(/const NODE_VERSION = '([^']+)'/)?.[1]
  const hash = source.match(/const NODE_SHA256 = '([^']+)'/)?.[1]
  expect(version).toBe('22.19.0')
  // Official nodejs.org/dist/v22.19.0/SHASUMS256.txt, win-x64.zip.
  expect(hash).toBe('ea3fad0e67a991d8477d8c01344b56e69c676ccb733f065b22436994b1253f86')
})
