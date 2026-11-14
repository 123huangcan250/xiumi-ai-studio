import { expect, it } from 'vitest'
import { importFile } from '../../server/importer'

it('reports a readable recovery action for a damaged Word document', async () => {
  await expect(importFile(Buffer.from('not a zip'), 'broken.docx')).rejects.toMatchObject({ status: 400, message: '无法读取这个 Word 文件。文件可能已损坏或不是有效的 .docx，请用 Word 重新另存为 .docx 后再导入，或改用 Markdown/TXT。' })
})
