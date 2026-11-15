import type { APIRequestContext } from '@playwright/test'

export async function seedShellProject<T extends { id: string }>(request: APIRequestContext, seed: T) {
  const path = '/api/projects/' + encodeURIComponent(seed.id)
  const current = await request.get(path)
  let revision: string | null = null
  if (current.status() === 200) {
    const project = await current.json()
    if (project?.id !== seed.id || typeof project.revision !== 'string' || !project.revision) {
      throw new Error('Shell fixture GET did not return the requested project and its revision')
    }
    revision = project.revision
  } else if (current.status() !== 404) {
    throw new Error('Shell fixture GET failed: HTTP ' + current.status())
  }

  const write = await request.put(path, { data: { ...seed, revision } })
  if (write.status() !== 200) throw new Error('Shell fixture PUT failed: HTTP ' + write.status())
  const result = await write.json()
  if (result?.ok !== true || typeof result.revision !== 'string' || !result.revision || result.revision === revision) {
    throw new Error('Shell fixture PUT did not acknowledge a new revision')
  }
  return { revision: result.revision as string }
}
