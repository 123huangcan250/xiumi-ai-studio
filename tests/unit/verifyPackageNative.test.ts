import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { sharpNativePackage } from '../../scripts/verifyPackageNative'

const native = '@img/sharp-win32-x64'
const fixtures: string[] = []
afterEach(() => {
  for (const base of fixtures.splice(0)) rmSync(base, { recursive: true, force: true })
})

function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'xiumi-native-verifier-')))
  fixtures.push(base)
  const root = join(base, 'unpacked')
  const modules = join(root, 'app', 'node_modules')
  const sharp = join(modules, 'sharp')
  mkdirSync(sharp, { recursive: true })
  writeFileSync(join(sharp, 'package.json'), JSON.stringify({ name: 'sharp' }))
  return { base, root, modules, sharp }
}

function writeNative(dir: string, name = native) {
  mkdirSync(dir, { recursive: true })
  const manifest = join(dir, 'package.json')
  writeFileSync(manifest, JSON.stringify({ name, exports: { './package': './package.json' } }))
  return manifest
}

it('resolves the Windows native manifest nested under the actual unpacked Sharp dependency', () => {
  const { root, sharp } = fixture()
  const manifest = writeNative(join(sharp, 'node_modules', native))
  expect(sharpNativePackage(root)).toBe(manifest)
})

it('accepts the older unpacked layout when Sharp can still resolve its native dependency', () => {
  const { root, modules } = fixture()
  const manifest = writeNative(join(modules, native))
  expect(sharpNativePackage(root)).toBe(manifest)
})

it('rejects a dependency that resolves outside the unpacked root', () => {
  const { base, root, modules } = fixture()
  const outside = join(base, 'outside')
  writeNative(outside)
  mkdirSync(join(modules, '@img'), { recursive: true })
  symlinkSync(outside, join(modules, native), 'junction')
  expect(() => sharpNativePackage(root)).toThrow('outside unpacked root')
})

it('rejects a resolvable manifest with the wrong package name', () => {
  const { root, modules } = fixture()
  writeNative(join(modules, native), 'wrong-native')
  expect(() => sharpNativePackage(root)).toThrow('Unexpected native runtime package')
})

it('rejects a missing manifest', () => {
  const { root } = fixture()
  expect(() => sharpNativePackage(root)).toThrow()
})

it('rejects a package export that points somewhere other than its manifest', () => {
  const { root, modules } = fixture()
  const dir = join(modules, native)
  const manifest = writeNative(dir)
  writeFileSync(manifest, JSON.stringify({ name: native, exports: { './package': './other.json' } }))
  writeFileSync(join(dir, 'other.json'), JSON.stringify({ name: native }))
  expect(() => sharpNativePackage(root)).toThrow('Unexpected native runtime package')
})
