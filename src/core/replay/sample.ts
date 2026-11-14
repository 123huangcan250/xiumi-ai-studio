// 示例模板：深色赛博蓝图风，两个场景。
import { defaultReplay, makeItem, makeScene } from './schema'
import type { ReplayDoc } from './types'

export function sampleReplay(): ReplayDoc {
  const d = defaultReplay()
  return {
    ...d,
    canvas: { width: 750, background: { type: 'gradient', value: '#050b1a,#0a1f44', grid: { color: '#15335e', size: 50 } } },
    cursors: { count: 3, show: true, names: ['Ada', '林', 'Kai'] },
    scenes: [
      makeScene([
        makeItem('tag', { content: 'BUILD LOG · 2026' }),
        makeItem('title', { content: '一篇推文，是这样被写出来的' }),
        makeItem('text', { content: '三位编辑在同一块画布上协作：从空白背景板开始，标题、正文、按钮和数据卡一个接一个被编辑出来。' }),
        makeItem('button', { content: '开始阅读' }),
        makeItem('button', { content: '查看过程' }),
        makeItem('stat', { content: '12', label: '位编辑' }),
        makeItem('stat', { content: '48', label: '次修改' }),
        makeItem('stat', { content: '3.6s', label: '成稿用时' }),
      ]),
      {
        ...makeScene([
          makeItem('subtitle', { content: 'PROJECT · 编辑回放' }),
          makeItem('text', { content: '把写作过程做成动画：画线框、标尺寸、打字、拖入图片，故障闪烁后定稿。光标只负责演示，删掉也不影响成稿。', label: 'PROJECT 01', style: { fill: '#0d2547', stroke: '#1f4f8f', color: '#cfe0ff' } }),
          makeItem('image', { content: '', label: '在右侧为这个图片元素选择素材' }),
          makeItem('tag', { content: 'SVG' }),
          makeItem('tag', { content: 'SMIL' }),
          makeItem('tag', { content: '待真机验证', enter: 'alert-box' }),
        ]),
        finale: 'swarm',
      },
    ],
  }
}
