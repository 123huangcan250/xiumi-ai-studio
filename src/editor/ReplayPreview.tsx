// 编辑回放：画布定格显示 + 预览器（pauseAnimations + setCurrentTime 拖动时间轴）。
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { compileReplay, REPLAY_ERROR } from '../core/compiler'
import { displayHtml } from '../core/images'
import { replayFinalTimes } from '../core/replay'
import { findBlock } from '../core/tree'
import type { Block } from '../core/types'
import { Modal } from './Modal'
import { useStore } from './store'

type ReplayBlock = Block<'replay'>

/** 预览一律按自动播放计时（点击开始方案在预览里等价于“点击后的时间”） */
const asAuto = (b: ReplayBlock): ReplayBlock => (b.props.playback.trigger === 'tap' ? { ...b, props: { ...b.props, playback: { ...b.props.playback, trigger: 'auto' } } } : b)

function freeze(root: HTMLElement | null, times: number[]) {
  root?.querySelectorAll('svg').forEach((svg, i) => {
    // 只处理每个场景的根 svg
    if (svg.parentElement?.closest('svg')) return
    svg.pauseAnimations()
    // 时间异常时停在开头，不让整个模块报错
    const t = times[i]
    svg.setCurrentTime(Number.isFinite(t) ? t : 0)
  })
}

/** 画布上的回放模块：定格在成稿，右上角可打开预览器 */
export const ReplayCanvasBody = memo(function ReplayCanvasBody({ block }: { block: ReplayBlock }) {
  // A final-frame canvas is not an animation player: retain looping only in the
  // interactive preview and exported work. Seeking a zero-hold loop to its end
  // otherwise lands exactly at the beginning of its next cycle.
  const shown = useMemo(() => ({ ...block, props: { ...block.props, playback: { ...block.props.playback, trigger: 'auto' as const, loop: undefined } } }), [block])
  const html = useMemo(() => displayHtml(compileReplay(shown).html), [shown])
  const finals = useMemo(() => replayFinalTimes(shown.props), [shown])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => freeze(ref.current, finals), [html, finals])
  return (
    <div className="replay-canvas">
      <div ref={ref} className="block-html" dangerouslySetInnerHTML={{ __html: html }} />
      <button
        className="replay-play"
        onClick={(e) => {
          e.stopPropagation()
          window.dispatchEvent(new CustomEvent('open-replay', { detail: { id: block.id } }))
        }}
        data-testid="replay-open"
      >
        ▶ 预览动效
      </button>
    </div>
  )
})

const fmt = (t: number) => `${t.toFixed(2)}s`

export function ReplayPreviewModal({ block, onClose }: { block: ReplayBlock; onClose: () => void }) {
  const [showCursors, setShowCursors] = useState(block.props.cursors.show)
  const [speed, setSpeed] = useState(1)
  // 接力播放的模块（设置了开始时间）从自己的开始时间预览
  const from = block.props.playback.start ?? 0
  const [t, setT] = useState(from)
  const [playing, setPlaying] = useState(true)
  const shown = useMemo(() => asAuto(block), [block])
  const out = useMemo(() => compileReplay(shown, {}, showCursors), [shown, showCursors])
  const html = useMemo(() => displayHtml(out.html), [out])
  const cycle = out.scenes[0]?.cycle
  const max = Math.max(...out.scenes.map((s) => s.cycle ?? s.total))
  const ref = useRef<HTMLDivElement>(null)
  const tRef = useRef(from)

  const seek = useCallback(
    (v: number) => {
      tRef.current = Math.max(0, Math.min(max, v))
      setT(tRef.current)
    },
    [max],
  )

  // 时间轴：所有场景统一暂停，再按当前时间定位（循环模式由 SMIL 自身按周期取模）
  useEffect(() => freeze(ref.current, out.scenes.map(() => t)), [t, html, out.scenes])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * speed
      last = now
      let next = tRef.current + dt
      if (next >= max) {
        if (cycle) next = next % max
        else {
          next = max
          setPlaying(false)
        }
      }
      tRef.current = next
      setT(next)
      if (next < max || cycle) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, max, cycle])

  // 测试钩子：E2E 用它定位到指定时间截图
  useEffect(() => {
    const w = window as unknown as { __replaySeek?: (v: number) => void }
    w.__replaySeek = (v) => {
      setPlaying(false)
      seek(v)
    }
    return () => {
      delete w.__replaySeek
    }
  }, [seek])

  const issues = [...out.errors.map((e) => `${REPLAY_ERROR} ${e}`), ...out.warnings]
  return (
    <Modal title="预览编辑回放" onClose={onClose} width={760}>
      <div className="replay-preview">
        <div className="replay-controls">
          <button
            className="primary"
            onClick={() => {
              if (!playing && tRef.current >= max) seek(from)
              setPlaying(!playing)
            }}
            data-testid="replay-toggle"
          >
            {playing ? '❚❚ 暂停' : '▶ 播放'}
          </button>
          <button
            onClick={() => {
              seek(from)
              setPlaying(true)
            }}
          >
            ↺ 重播
          </button>
          <input type="range" min={0} max={max} step={0.01} value={t} onChange={(e) => (setPlaying(false), seek(Number(e.target.value)))} data-testid="replay-seek" />
          <span className="replay-time" data-testid="replay-time">
            {fmt(t)} / {fmt(max)}
          </span>
          <div className="seg">
            {[0.5, 1].map((s) => (
              <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>
                {s}x
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={showCursors} onChange={(e) => setShowCursors(e.target.checked)} data-testid="replay-cursors" /> 光标层
          </label>
        </div>
        <div className="replay-stats">
          {out.scenes.map((s, i) => (
            <span key={i}>
              场景 {i + 1}：{fmt(s.end)} 完成 · {(s.bytes / 1024).toFixed(1)} KB
            </span>
          ))}
          {block.props.playback.trigger === 'tap' && <span>点击开始方案：预览按点击后的时间计时</span>}
        </div>
        <div className="replay-stage">
          <div ref={ref} className="replay-phone" dangerouslySetInnerHTML={{ __html: html }} data-testid="replay-stage" />
        </div>
        {issues.length > 0 && (
          <div className="replay-issues">
            {issues.map((w) => (
              <p key={w} className={w.startsWith(REPLAY_ERROR) ? 'warn error' : 'warn'}>
                ⚠ {w}
              </p>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

/** 监听画布或属性面板发出的 open-replay 事件，打开对应模块的预览器 */
export function ReplayHost() {
  const [id, setId] = useState<string | null>(null)
  const block = useStore((s) => (id ? findBlock(s.doc.blocks, id)?.block : undefined))
  useEffect(() => {
    const open = (e: Event) => setId((e as CustomEvent<{ id: string }>).detail.id)
    window.addEventListener('open-replay', open)
    return () => window.removeEventListener('open-replay', open)
  }, [])
  if (!block || block.type !== 'replay') return null
  return <ReplayPreviewModal block={block} onClose={() => setId(null)} />
}
