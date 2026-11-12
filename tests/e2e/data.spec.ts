// 数据与备份、历史版本、退出按钮
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'

test('历史版本：保存为新版本后修改标题，再恢复', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const title = page.getByLabel('文章标题')
  await title.fill('版本测试 · 原标题')
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })
  page.once('dialog', (d) => d.accept('第一版'))
  await page.getByRole('button', { name: '历史版本' }).click()
  await page.getByRole('button', { name: '保存当前为新版本' }).click()
  const dialog = page.getByRole('dialog', { name: '历史版本' })
  await expect(dialog.locator('.list-row b')).toHaveText(['第一版'])
  await dialog.getByRole('button', { name: '关闭' }).click()

  await title.fill('版本测试 · 改过的标题')
  await page.getByRole('button', { name: '历史版本' }).click()
  await dialog.getByRole('button', { name: '恢复' }).click()
  await expect(title).toHaveValue('版本测试 · 原标题')
})

test('数据与备份：下载备份、预览后恢复；从旧版本迁移', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('open-data').click()
  const dialog = page.getByRole('dialog', { name: '数据与备份' })
  await expect(dialog.getByTestId('data-dir')).not.toHaveText('读取中…')

  const download = page.waitForEvent('download')
  await dialog.getByTestId('download-backup').click()
  const file = await (await download).path()
  expect(readFileSync(file).subarray(0, 2).toString()).toBe('PK')

  // 恢复刚才的备份：内容都已存在，预览显示保留本机版本，确认后不复制任何文件
  await dialog.getByTestId('restore-file').setInputFiles({ name: 'backup.zip', mimeType: 'application/zip', buffer: readFileSync(file) })
  await expect(dialog.getByTestId('merge-plan')).toContainText('保留本机版本')
  await dialog.getByTestId('restore-apply').click()
  await expect(dialog.getByTestId('merge-result')).toContainText('已导入 0 个文件')

  // 旧版本（源码运行）的 data 文件夹
  const legacy = mkdtempSync(join(tmpdir(), 'xiumi 旧版 '))
  mkdirSync(join(legacy, 'data', 'projects'), { recursive: true })
  writeFileSync(join(legacy, 'data', 'projects', 'legacy-e2e.json'), JSON.stringify({ id: 'legacy-e2e', title: '旧版迁移来的项目', author: '', digest: '', themeId: 'tsinghua', blocks: [], createdAt: 1, updatedAt: 1 }))
  await dialog.getByTestId('legacy-path').fill(legacy)
  await dialog.getByTestId('legacy-preview').click()
  const plan = dialog.getByTestId('merge-plan')
  await expect(plan).toContainText(join(legacy, 'data'))
  await expect(plan).toContainText('项目：新增 1')
  await dialog.getByTestId('legacy-apply').click()
  await expect(dialog.getByTestId('merge-result')).toContainText('已导入 1 个文件')

  await dialog.getByRole('button', { name: '刷新页面以显示导入的内容' }).click()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: '项目', exact: true }).click()
  await expect(page.getByText('旧版迁移来的项目')).toBeVisible()
})

test('下载备份：先等正在进行的保存完成，备份包含最新内容', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const title = page.getByLabel('文章标题')
  await title.fill('备份测试 · 旧内容')
  await expect(page.getByTestId('save-status')).toHaveText('已保存', { timeout: 10_000 })

  // 让下一次保存请求停住，模拟保存较慢
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let held = false
  await page.route('**/api/projects/**', async (route) => {
    if (route.request().method() === 'PUT') {
      held = true
      await gate
    }
    await route.continue()
  })
  await title.fill('备份测试 · 最新内容')
  await page.getByTestId('open-data').click()
  const dialog = page.getByRole('dialog', { name: '数据与备份' })
  let downloaded = false
  const download = page.waitForEvent('download').then((d) => ((downloaded = true), d))
  await dialog.getByTestId('download-backup').click()
  await expect.poll(() => held).toBe(true)
  await page.waitForTimeout(500)
  expect(downloaded).toBe(false) // 保存完成前不开始下载
  release()

  const zip = unzipSync(readFileSync(await (await download).path()))
  const titles = Object.entries(zip)
    .filter(([k]) => /^projects\/[^/]+\.json$/.test(k))
    .map(([, v]) => JSON.parse(strFromU8(v)).title)
  expect(titles).toContain('备份测试 · 最新内容')
  expect(titles).not.toContain('备份测试 · 旧内容')
})

test('退出按钮：保存失败时不退出，也不提示已保存', async ({ page }) => {
  await page.route('**/api/app/info', async (route) => {
    const res = await route.fetch()
    await route.fulfill({ response: res, json: { ...(await res.json()), canQuit: true } })
  })
  let quitCalled = false
  await page.route('**/api/app/quit', (route) => {
    quitCalled = true
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.route('**/api/projects/**', (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ status: 500, json: { error: '模拟保存失败' } }) : route.continue(),
  )
  await page.getByLabel('文章标题').fill('退出测试 · 未保存修改')

  // 第一次确认“退出”，第二次在“保存失败，仍要退出吗”时选取消
  const messages: string[] = []
  page.on('dialog', (d) => {
    messages.push(d.message())
    return messages.length === 1 ? d.accept() : d.dismiss()
  })
  await page.getByTestId('quit-app').click()
  await expect.poll(() => messages.length).toBe(2)
  expect(messages[1]).toContain('模拟保存失败')
  await expect(page.getByTestId('quit-screen')).toHaveCount(0)
  await expect(page.getByTestId('save-status')).toHaveText('保存失败')
  expect(quitCalled).toBe(false)

  // 坚持退出：可以退出，但页面如实说明没有保存
  messages.length = 0
  page.removeAllListeners('dialog')
  page.on('dialog', (d) => d.accept())
  await page.getByTestId('quit-app').click()
  await expect(page.getByTestId('quit-screen')).toContainText('没有保存成功')
  await expect(page.getByTestId('quit-screen')).not.toContainText('内容已保存')
  expect(quitCalled).toBe(true)
})

test('退出按钮：保存后通知程序退出，并显示已退出页面', async ({ page }) => {
  // 不真的结束测试服务器：拦截接口，只验证界面流程
  await page.route('**/api/app/info', async (route) => {
    const res = await route.fetch()
    await route.fulfill({ response: res, json: { ...(await res.json()), canQuit: true } })
  })
  let quitCalled = false
  await page.route('**/api/app/quit', (route) => {
    quitCalled = true
    return route.fulfill({ json: { ok: true } })
  })
  await page.goto('/')
  page.once('dialog', (d) => d.accept())
  await page.getByTestId('quit-app').click()
  await expect(page.getByTestId('quit-screen')).toContainText('XIUMI AI Studio 已退出')
  expect(quitCalled).toBe(true)
})
