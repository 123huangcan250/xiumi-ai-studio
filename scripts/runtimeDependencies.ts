import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import { copyDir } from './fsutil'
class MissingRuntimeDependencyError extends Error {}
function packageDir(name: string, from: string): string {
  let dir = from
  for (;;) {
    const candidate = join(dir, 'node_modules', ...name.split('/'))
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    const sibling = join(dir, ...name.split('/'))
    if (dir.endsWith(`${sep}node_modules`) && existsSync(join(sibling, 'package.json'))) return realpathSync(sibling)
    const parent = dirname(dir)
    if (parent === dir) throw new MissingRuntimeDependencyError(`Missing runtime dependency: ${name}`)
    dir = parent
  }
}
/** Preserve each dependency's resolved version, instead of flattening incompatible versions by name. */
export function copyRuntimeDependencies(names: string[], from: string, destination: string): Set<string> {
  if (basename(destination) !== 'node_modules') throw new Error('Runtime destination must be a node_modules directory')
  const copied = new Set<string>()
  let count = 0
  const copy = (name: string, origin: string, modules: string, ancestors: Set<string>) => {
    const dir = packageDir(name, origin)
    if (ancestors.has(dir)) return
    if (++count > 5000 || ancestors.size > 100) throw new Error('Runtime dependency graph exceeds safe packaging limits')
    const target = join(modules, ...name.split('/'))
    mkdirSync(target, { recursive: true })
    copyDir(dir, target, new Set(['node_modules', '.git']))
    copied.add(name)
    const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { dependencies?: Record<string,string>; optionalDependencies?: Record<string,string> }
    const chain = new Set([...ancestors, dir])
    for (const dependency of Object.keys(meta.dependencies ?? {})) copy(dependency, dir, join(target, 'node_modules'), chain)
    for (const optional of Object.keys(meta.optionalDependencies ?? {})) {
      let resolved: string
      try { resolved = packageDir(optional, dir) } catch (error) {
        if (error instanceof MissingRuntimeDependencyError) continue
        throw error
      }
      // Missing platform optional packages are expected; copying errors are not silently hidden.
      if (resolved) copy(optional, dir, join(target, 'node_modules'), chain)
    }
  }
  for (const name of names) copy(name, from, destination, new Set())
  return copied
}
