import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, isAbsolute, join, relative, sep } from 'node:path'

/** Resolve the Windows native manifest from the unpacked app's copy of Sharp. */
export function sharpNativePackage(root: string): string {
  const unpacked = realpathSync(root)
  function within(file: string): string {
    const resolved = realpathSync(file)
    const path = relative(unpacked, resolved)
    if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
      throw new Error('Runtime dependency is outside unpacked root')
    }
    return resolved
  }
  const sharp = within(join(unpacked, 'app', 'node_modules', 'sharp', 'package.json'))
  const name = '@img/sharp-win32-x64'
  const manifest = within(createRequire(sharp).resolve(`${name}/package`))
  if (basename(manifest) !== 'package.json' || JSON.parse(readFileSync(manifest, 'utf8')).name !== name) {
    throw new Error('Unexpected native runtime package')
  }
  return manifest
}
