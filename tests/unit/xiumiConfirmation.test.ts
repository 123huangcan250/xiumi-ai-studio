// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlock } from '../../src/core/blocks'
import { api } from '../../src/editor/api'
import { emptyDoc, useStore } from '../../src/editor/store'
import { Toolbar } from '../../src/editor/Toolbar'
import { download } from '../../src/editor/wechatOutput'

vi.mock('../../src/editor/api', () => ({ api: { appInfo: vi.fn(async () => ({ canQuit: false })), wechatStatus: vi.fn(), wechatUploadImages: vi.fn() } }))
vi.mock('../../src/editor/wechatOutput', async importOriginal => ({ ...await importOriginal<any>(), download: vi.fn() }))
let host: HTMLDivElement
let root: Root
beforeEach(async () => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.mocked(api.wechatStatus).mockResolvedValue({ configured: true, appid: 'test' })
  vi.mocked(api.wechatUploadImages).mockImplementation(async urls => Object.fromEntries(urls.map(u => [u, `https://mmbiz.qpic.cn/${'x'.repeat(70000)}`])))
  useStore.setState({ toast: null, doc: { ...emptyDoc(), blocks: [
    createBlock('html', { html: `<p>${'a'.repeat(70000)}</p>` }),
    createBlock('image', { image: { src: '/media/test.jpg' } }),
  ] } })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(Toolbar)))
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=open-export]')!.click())
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('asks about the actual multipart count after upload and cancels without downloading', async () => {
  const confirm = vi.fn((_message: string) => false)
  vi.stubGlobal('confirm', confirm)
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=xiumi-upload]')!.click())
  expect(useStore.getState().toast?.kind, useStore.getState().toast?.text).not.toBe('error')
  expect(api.wechatUploadImages).toHaveBeenCalledTimes(1)
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(confirm.mock.calls[0][0]).toContain('2 份')
  expect(confirm.mock.calls[0][0]).toContain('图片已上传')
  expect(download).not.toHaveBeenCalled()
  expect(host.querySelector<HTMLButtonElement>('[data-testid=xiumi-upload]')!.disabled).toBe(false)
})

it('downloads only after accepting the changed count', async () => {
  const confirm = vi.fn((_message: string) => true)
  vi.stubGlobal('confirm', confirm)
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=xiumi-upload]')!.click())
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(download).toHaveBeenCalledTimes(1)
  expect(vi.mocked(download).mock.calls[0][0]).toMatch(/\.zip$/)
})

it('does not ask a second time when upload leaves the part count unchanged', async () => {
  vi.mocked(api.wechatUploadImages).mockImplementation(async urls => Object.fromEntries(urls.map(u => [u, 'https://mmbiz.qpic.cn/test.jpg'])))
  const confirm = vi.fn((_message: string) => true)
  vi.stubGlobal('confirm', confirm)
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid=xiumi-upload]')!.click())
  expect(confirm).not.toHaveBeenCalled()
  expect(download).toHaveBeenCalledTimes(1)
})
