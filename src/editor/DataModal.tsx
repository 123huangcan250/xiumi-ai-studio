// 数据与备份：数据保存位置、备份下载、从备份恢复、从旧版本迁移、公众号接口配置文件。
// 恢复和迁移都先预览，确认后才写入；同名内容保留本机版本，不覆盖，来源文件不改动。
import { useEffect, useState } from 'react'
import { api, type AppInfo, type MergePlanView, type MergeResult } from './api'
import { Modal } from './Modal'
import { flushSave, useStore } from './store'

function PlanView({ plan }: { plan: MergePlanView }) {
  const rows = Object.entries(plan.counts).filter(([, c]) => c.add || c.skip)
  return (
    <div className="report" data-testid="merge-plan">
      <p>来源：<code>{plan.source}</code></p>
      <p>写入：<code>{plan.target}</code></p>
      {rows.map(([k, c]) => (
        <p key={k}>
          {c.label}：新增 <b>{c.add}</b>
          {c.skip > 0 && `，本机已有同名 ${c.skip} 个（保留本机版本）`}
        </p>
      ))}
      {!rows.length && <p>没有可导入的项目、模板、组件或素材。</p>}
      {(plan.ai.add.length > 0 || plan.ai.skip.length > 0) && (
        <p>
          AI 模型配置：新增 {plan.ai.add.join('、') || '无'}
          {plan.ai.skip.length > 0 && `；已有 ${plan.ai.skip.join('、')}（保留本机）`}
          {plan.ai.withKeys ? '。含 API 密钥，只在本机之间复制。' : plan.ai.add.length ? '。不含密钥，导入后需重新填写。' : ''}
        </p>
      )}
      {plan.env && (
        <p>
          公众号配置 .env：{plan.env.action === 'copy' ? <>复制到 <code>{plan.env.target}</code></> : '本机已有，保留本机版本'}
        </p>
      )}
      {plan.ignored > 0 && <p className="hint">另有 {plan.ignored} 个缓存、日志或无法识别的文件，不会导入。</p>}
    </div>
  )
}

const resultText = (r: MergeResult) =>
  `已导入 ${r.copied} 个文件，跳过本机已有的 ${r.skipped} 个${r.aiAdded ? `，新增 ${r.aiAdded} 套 AI 配置` : ''}${r.envCopied ? '，已复制公众号配置（重启后生效）' : ''}。`

export function DataModal({ info, onClose }: { info: AppInfo | null; onClose: () => void }) {
  const notify = useStore((s) => s.notify)
  const [busy, setBusy] = useState('')
  const [restore, setRestore] = useState<{ token: string; plan: MergePlanView } | null>(null)
  const [legacyPath, setLegacyPath] = useState('')
  const [migrate, setMigrate] = useState<MergePlanView | null>(null)
  const [done, setDone] = useState('')
  const [wx, setWx] = useState<{ configured: boolean } | null>(null)
  useEffect(() => {
    api.wechatStatus().then(setWx).catch(() => setWx(null))
  }, [])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    try {
      await fn()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy('')
    }
  }
  const open = (target: 'data' | 'logs' | 'env') =>
    run('打开中…', async () => {
      const r = await api.openFolder(target)
      if (!r.opened) notify(`位置：${r.path}`)
    })

  return (
    <Modal title="数据与备份" onClose={onClose} width={620}>
      <div className="data-modal">
      <h4>数据保存位置</h4>
      <p className="hint">
        项目、历史版本、模板、组件、主题、素材和 AI 设置都保存在这里。删除或更新程序不会删除这些数据。
      </p>
      <p>
        <code data-testid="data-dir">{info?.dataDir ?? '读取中…'}</code>
      </p>
      {info?.canOpenFolder && (
        <div className="row gap">
          <button onClick={() => open('data')}>打开数据文件夹</button>
          <button onClick={() => open('logs')}>打开日志文件夹</button>
        </div>
      )}

      <h4>备份</h4>
      <p className="hint">下载一个 zip 文件，包含全部项目、版本、模板、组件、主题和素材。为安全起见不包含 AI 密钥和公众号 AppSecret。</p>
      <button
        className="wide"
        data-testid="download-backup"
        disabled={!!busy}
        onClick={() =>
          run('正在保存当前内容…', async () => {
            // 先确认当前编辑已写入，再开始下载，备份才包含最新内容
            try {
              await flushSave()
            } catch (e) {
              if (!confirm(`当前内容保存失败：${(e as Error).message}\n\n仍要下载备份吗？备份里不会包含最近没有保存的修改。`)) return
            }
            const a = document.createElement('a')
            a.href = '/api/data/backup'
            a.download = ''
            document.body.append(a)
            a.click()
            a.remove()
          })
        }
      >
        下载备份（zip）
      </button>

      <h4>从备份恢复</h4>
      <p className="hint">选择之前下载的备份 zip。先显示将导入的内容，确认后才写入；本机已有的同名内容会保留，不会被覆盖。</p>
      <input
        type="file"
        accept=".zip,application/zip"
        data-testid="restore-file"
        disabled={!!busy}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) run('读取备份…', async () => setRestore(await api.restoreUpload(f)))
        }}
      />
      {restore && (
        <>
          <PlanView plan={restore.plan} />
          <div className="modal-actions">
            <button onClick={() => setRestore(null)}>取消</button>
            <button
              className="primary"
              data-testid="restore-apply"
              disabled={!!busy}
              onClick={() =>
                run('恢复中…', async () => {
                  const r = await api.restoreApply(restore.token)
                  setRestore(null)
                  setDone(resultText(r))
                })
              }
            >
              确认恢复
            </button>
          </div>
        </>
      )}

      <h4>从旧版本迁移</h4>
      <p className="hint">
        以前用源码（pnpm）运行时，数据在项目文件夹的 <code>data</code> 里，公众号配置在 <code>.env</code>。填写旧的项目文件夹或 data 文件夹的位置，先检测再迁移。迁移只复制，原文件保持不变。
      </p>
      <div className="row gap">
        <input className="grow" value={legacyPath} placeholder="例如 D:\xiumi-ai-studio" onChange={(e) => (setLegacyPath(e.target.value), setMigrate(null))} data-testid="legacy-path" />
        <button disabled={!legacyPath.trim() || !!busy} onClick={() => run('检测中…', async () => setMigrate((await api.migratePreview(legacyPath)).plan))} data-testid="legacy-preview">
          检测
        </button>
      </div>
      {migrate && (
        <>
          <PlanView plan={migrate} />
          <div className="modal-actions">
            <button onClick={() => setMigrate(null)}>取消</button>
            <button
              className="primary"
              data-testid="legacy-apply"
              disabled={!!busy}
              onClick={() =>
                run('迁移中…', async () => {
                  const r = await api.migrateApply(legacyPath)
                  setMigrate(null)
                  setDone(resultText(r))
                })
              }
            >
              确认迁移
            </button>
          </div>
        </>
      )}

      {done && (
        <div className="report" data-testid="merge-result">
          <p>{done}</p>
          <button
            className="primary"
            onClick={() =>
              flushSave().then(
                () => location.reload(),
                (e: Error) => notify(`当前内容保存失败，未刷新页面：${e.message}`, 'error'),
              )
            }
          >
            刷新页面以显示导入的内容
          </button>
        </div>
      )}

      <h4>公众号接口（可选）</h4>
      <p className="hint">
        {wx?.configured ? '已配置。' : '未配置。'}
        推送草稿箱和上传微信图床需要公众号 AppID / AppSecret，并在公众号后台「设置与开发 → 基本配置」把本机出口 IP 加入白名单。填写在下面的配置文件里，保存后重启程序生效。
        {info && !info.packaged && '（源码运行时也可以写在项目根目录的 .env。）'}
      </p>
      <p>
        <code>{info?.envFile}</code>
      </p>
      {info?.canOpenFolder && <button onClick={() => open('env')}>{info.envExists ? '用记事本打开配置文件' : '创建并打开配置文件'}</button>}

      {busy && <p className="hint">{busy}</p>}
      {info && <p className="hint">版本 {info.version}{info.packaged ? '' : '（源码运行）'}</p>}
      </div>
    </Modal>
  )
}
