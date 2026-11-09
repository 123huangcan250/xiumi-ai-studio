// 一键生成文案：输入活动描述、选文风和篇幅，AI 写出带标题级别的完整文案；可以直接改、按意见重写，或导入到正文。
import { useMemo, useState } from 'react'
import { checkCopy, copyToMarkdown, LEVEL_NAMES, limitLevels, normalizeCopyText, parseCopy } from '../core/copy'
import { api } from './api'
import { Modal } from './Modal'
import { useStore } from './store'

const STYLES = [
  { name: '新闻通讯', desc: '客观克制，交代清楚时间、人物、经过' },
  { name: '温暖叙事', desc: '从人物和细节写起，有温度' },
  { name: '青春活泼', desc: '轻快口语化，节奏明快' },
  { name: '庄重典雅', desc: '正式场合，用词讲究' },
  { name: '理性科普', desc: '讲清楚原理和意义，条理分明' },
  { name: '散文随笔', desc: '有画面感，抒情但不空泛' },
]
const LENGTHS = [
  { name: '短篇', range: '800–1200' },
  { name: '中篇', range: '1500–2000' },
  { name: '长篇', range: '2500–3200' },
]

export function Copywriter({ onClose, onImport, levels: kitLevels, hasText }: { onClose: () => void; onImport: (text: string) => void; levels: number; hasText: boolean }) {
  const notify = useStore((s) => s.notify)
  const [brief, setBrief] = useState('')
  const [style, setStyle] = useState(STYLES[1].name)
  const [customStyle, setCustomStyle] = useState('')
  const [length, setLength] = useState(LENGTHS[1].range)
  // 已选模板时默认用模板支持的标题级数
  const [levels, setLevels] = useState(Math.min(3, Math.max(1, kitLevels || 2)))
  const [extra, setExtra] = useState('')
  const [result, setResult] = useState('')
  const [revise, setRevise] = useState('')
  const [busy, setBusy] = useState(false)
  const check = useMemo(() => (result ? checkCopy(result, levels) : null), [result, levels])

  const write = async (again: boolean) => {
    setBusy(true)
    try {
      const styleText = customStyle.trim() || `${style}：${STYLES.find((s) => s.name === style)?.desc ?? ''}`
      const r = await api.aiCopywrite({ brief, style: styleText, length, levels, extra, ...(again && result && { previous: result, revise }) })
      const md = normalizeCopyText(r)
      if (!md) throw new Error('模型没有返回文案')
      setResult(md)
      setRevise('')
    } catch (e: any) {
      notify(e.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const importText = () => {
    if (hasText && !confirm('用生成的文案替换正文框里现有的内容？')) return
    onImport(result)
    onClose()
  }

  return (
    <Modal title="AI 生成文案" onClose={onClose} width={1100}>
      <div className="copywriter">
        <div className="cw-form">
          <label className="field">
            <span>活动的大致描述（时间、地点、谁参加、做了什么、有什么亮点或原话，越具体越好）</span>
            <textarea rows={9} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder={'例如：10 月 18—27 日，校团委和学生科协办了秋季科技文化节。开幕式在主楼广场，五个院系的同学做了“光的接力”灯光表演；20 日在图书馆有 AI 主题论坛，请了四位嘉宾；22—24 日东区创客空间有创客市集，42 个摊位，最受欢迎的是会写诗的打字机……'} data-testid="cw-brief" />
          </label>
          <div className="field">
            <span>文风</span>
            <div className="seg">
              {STYLES.map((s) => (
                <button key={s.name} title={s.desc} className={style === s.name && !customStyle.trim() ? 'on' : ''} onClick={() => { setStyle(s.name); setCustomStyle('') }}>{s.name}</button>
              ))}
            </div>
            <input value={customStyle} onChange={(e) => setCustomStyle(e.target.value)} placeholder="或自己描述文风，例如：像人物特写那样写，多用对话" data-testid="cw-style" />
          </div>
          <div className="row gap wrap">
            <div className="field">
              <span>篇幅（正文字数）</span>
              <div className="seg">
                {LENGTHS.map((l) => <button key={l.range} className={length === l.range ? 'on' : ''} onClick={() => setLength(l.range)}>{l.name} {l.range}</button>)}
              </div>
            </div>
            <div className="field">
              <span>标题级别{kitLevels > 0 && `（所选模块有 ${kitLevels} 级标题）`}</span>
              <div className="seg">
                {[1, 2, 3].map((n) => <button key={n} className={levels === n ? 'on' : ''} onClick={() => setLevels(n)} data-testid={`cw-levels-${n}`}>{n} 级</button>)}
              </div>
            </div>
          </div>
          <label className="field"><span>补充要求（可选）</span><input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="例如：突出志愿者的故事；结尾提一下下届活动" /></label>
          <div className="modal-actions">
            <button className="primary" disabled={busy || !brief.trim()} onClick={() => write(false)} data-testid="cw-generate">{busy ? '生成中…' : result ? '重新生成' : '生成文案'}</button>
          </div>
        </div>
        <div className="cw-result">
          <div className="cw-legend">
            <b># 推文标题</b>
            {LEVEL_NAMES.slice(0, levels).map((n, i) => <span key={n}>{'#'.repeat(i + 2)} {n}</span>)}
            <span>&gt; 引语 —— 说话人</span>
          </div>
          <textarea className="cw-text" value={result} onChange={(e) => setResult(e.target.value)} placeholder="生成的文案会出现在这里，可以直接修改" data-testid="cw-result" />
          {check && (
            <div className="cw-check" data-testid="cw-check">
              <span>正文约 {check.chars} 字</span>
              {check.counts.map((c, i) => (c ? <span key={i}>{LEVEL_NAMES[i]} {c} 个</span> : null))}
              {check.problems.map((p) => <p key={p} className="warn">{p}</p>)}
              {check.problems.some((p) => p.includes('超过')) && (
                <button onClick={() => setResult(copyToMarkdown(limitLevels(parseCopy(result), levels)))}>把多出的标题改为加粗正文</button>
              )}
              {check.robot.length > 0 && <p className="warn">有套话，建议改掉：{check.robot.join('、')}</p>}
              {check.todo > 0 && <p className="warn">有 {check.todo} 处【待补充】，是活动描述里没有的信息，请补上真实内容后再排版</p>}
            </div>
          )}
          {result && (
            <>
              <div className="row gap">
                <input className="grow" value={revise} onChange={(e) => setRevise(e.target.value)} placeholder="修改意见（可选），例如：开头再短一点；第二节多写嘉宾的观点" data-testid="cw-revise" />
                <button disabled={busy} onClick={() => write(true)} data-testid="cw-rewrite">{busy ? '改写中…' : '按意见重写'}</button>
              </div>
              <div className="modal-actions">
                <button onClick={onClose}>取消</button>
                <button className="primary" onClick={importText} data-testid="cw-import">导入到正文</button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
