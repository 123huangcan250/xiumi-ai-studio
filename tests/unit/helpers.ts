import { docToMarkdown } from '../../src/core/exporters'
import type { Block } from '../../src/core/types'

export function exporterSmoke(blocks: Block[]) {
  return docToMarkdown({ id: 'x', title: 't', author: '', digest: '', themeId: 'tech-blue', blocks, createdAt: 0, updatedAt: 0 })
}
