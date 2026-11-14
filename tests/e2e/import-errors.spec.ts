import { expect, test } from '@playwright/test'

test('damaged Word import offers recovery and does not block a subsequent import', async ({ request }) => {
  const bad = await request.post('/api/import', { multipart: { file: { name: 'broken.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('not a zip') } } })
  expect(bad.status()).toBe(400)
  const error = await bad.json()
  expect(error.error).toContain('请用 Word 重新另存为 .docx')
  expect(error.error).not.toContain('jszip')
  const good = await request.post('/api/import', { multipart: { file: { name: 'recovery.md', mimeType: 'text/markdown', buffer: Buffer.from('# 测试标题\n\n导入恢复正常。') } } })
  expect(good.ok()).toBe(true)
  expect((await good.json()).text).toContain('导入恢复正常。')
})
