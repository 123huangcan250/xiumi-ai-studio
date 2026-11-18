// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { Workspace } from '../../src/editor/Workspace'

test('remembers focused workspace regions before a narrow viewport can hide them', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const mount = document.body.appendChild(document.createElement('div'))
  const root = createRoot(mount)
  try {
    const region = (tag: 'aside' | 'div', className: string, id: string) =>
      h(tag, { className, key: id }, h('button', { id: id + '-focus' }, id + ' control'))
    act(() => root.render(h(Workspace, { children: [
      region('aside', 'panel left', 'left'),
      region('div', 'canvas-wrap', 'canvas'),
      region('aside', 'panel right', 'right'),
    ] })))
    const workspace = mount.querySelector('.workspace')!
    const clickTab = (position: number) => act(() => workspace.querySelectorAll<HTMLButtonElement>('nav button')[position].click())
    const focusAndResize = (region: string) => {
      act(() => document.getElementById(region + '-focus')!.focus())
      // CSS may already have blurred the previously focused region by the time resize listeners run.
      act(() => (document.activeElement as HTMLElement).blur())
      act(() => window.dispatchEvent(new Event('resize')))
    }
    clickTab(0)
    expect(workspace.getAttribute('data-workspace-view')).toBe('left')
    for (const region of ['canvas', 'right', 'left']) {
      focusAndResize(region)
      expect(workspace.getAttribute('data-workspace-view')).toBe(region)
    }
  } finally {
    act(() => root.unmount())
    mount.remove()
    vi.unstubAllGlobals()
  }
})
