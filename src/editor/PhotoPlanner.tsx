// 照片面板：写照片描述；勾选几张照片组成一组（必须放进同一个多图版式）；指定照片或组放在文案中某一句话后面。
import { useMemo, useState } from 'react'
import { findAnchor, parseCopy, sectionOf } from '../core/copy'
import { roleDef, rolesForPhotos, type RoleId } from '../core/roles'
import type { Asset } from './api'

export interface PhotoGroup {
  id: string
  /** 素材 id */
  photos: string[]
  /** 版式；空表示按张数自动选 */
  layout: RoleId | ''
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function AnchorInput({ value, onChange, text, testId }: { value: string; onChange: (v: string) => void; text: string; testId?: string }) {
  const copy = useMemo(() => (value.trim() ? parseCopy(text) : null), [value, text])
  const hit = copy ? findAnchor(copy, value) : ''
  return (
    <div className="anchor">
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="放在这句话后面（从正文复制一句，可不填）" data-testid={testId} />
      {value.trim() && <small className={hit ? 'ok' : 'bad'}>{hit ? `✓ 在「${sectionOf(copy!, hit)}」` : '✗ 正文里找不到这句话'}</small>}
    </div>
  )
}

export function PhotoPlanner(props: {
  images: Asset[]
  setImages: (f: (x: Asset[]) => Asset[]) => void
  notes: Record<string, string>
  setNotes: (f: (n: Record<string, string>) => Record<string, string>) => void
  groups: PhotoGroup[]
  setGroups: (f: (g: PhotoGroup[]) => PhotoGroup[]) => void
  anchors: Record<string, string>
  setAnchors: (f: (a: Record<string, string>) => Record<string, string>) => void
  /** 所选模块里有的图片版式；没有选模板时为空，组的版式由 AI / 内置版式决定 */
  layouts: RoleId[]
  text: string
}) {
  const { images, setImages, notes, setNotes, groups, setGroups, anchors, setAnchors, layouts, text } = props
  const [sel, setSel] = useState<string[]>([])
  const no = (id: string) => images.findIndex((a) => a.id === id) + 1
  const groupOf = (id: string) => groups.find((g) => g.photos.includes(id))
  const letter = (g: PhotoGroup) => LETTERS[groups.indexOf(g)] ?? '?'
  const makeGroup = () => {
    const photos = [...sel].sort((a, b) => no(a) - no(b))
    setGroups((g) => [...g, { id: `g${Date.now().toString(36)}`, photos, layout: '' }])
    // 组成一组后，组员各自的位置失效，改用组的位置
    setAnchors((a) => Object.fromEntries(Object.entries(a).filter(([k]) => !photos.includes(k))))
    setSel([])
  }
  const remove = (id: string) => {
    setImages((x) => x.filter((y) => y.id !== id))
    setGroups((gs) => gs.map((g) => ({ ...g, photos: g.photos.filter((p) => p !== id) })).filter((g) => g.photos.length > 1))
    setSel((s) => s.filter((x) => x !== id))
  }

  return (
    <aside className="photo-notes" data-testid="photo-notes">
      <h5>照片（{images.length}）</h5>
      {images.length ? (
        <>
          <p className="tpl-note">写一句说明（在做什么、画面里是谁），AI 会把照片放到对应段落旁，也会用作图注。勾选几张照片可以组成一组，一组照片放进同一个多图版式。</p>
          {groups.map((g) => {
            const options = layouts.length ? rolesForPhotos(g.photos.length).filter((r) => layouts.includes(r)) : []
            return (
              <div key={g.id} className="photo-group" data-testid="photo-group">
                <div className="row gap">
                  <b>组 {letter(g)}</b>
                  <span className="grow">照片 {g.photos.map(no).join('、')}</span>
                  <button className="link" onClick={() => setGroups((gs) => gs.filter((x) => x.id !== g.id))} data-testid="ungroup">解散</button>
                </div>
                <select value={g.layout} onChange={(e) => setGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, layout: e.target.value as RoleId | '' } : x)))} data-testid="group-layout">
                  <option value="">{layouts.length ? `自动选 ${g.photos.length} 图版式` : '版式：排版时决定'}</option>
                  {options.map((r) => <option key={r} value={r}>{roleDef(r).name}</option>)}
                </select>
                {layouts.length > 0 && !options.length && <small className="bad">所选模块里没有 {g.photos.length} 图版式</small>}
                <AnchorInput value={anchors[g.id] ?? ''} onChange={(v) => setAnchors((a) => ({ ...a, [g.id]: v }))} text={text} testId="group-anchor" />
              </div>
            )
          })}
          {sel.length > 1 && (
            <button className="wide" onClick={makeGroup} data-testid="make-group">把选中的 {sel.length} 张组成一组</button>
          )}
          <ol className="photo-list">
            {images.map((a, i) => {
              const g = groupOf(a.id)
              return (
                <li key={a.id}>
                  <label className="photo-no" title="勾选后可组成一组">
                    <input type="checkbox" disabled={!!g} checked={sel.includes(a.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, a.id] : s.filter((x) => x !== a.id)))} data-testid={`photo-pick-${i + 1}`} />
                    {i + 1}
                  </label>
                  <img src={`/media/${a.file}?fit=1:1&w=160`} alt={a.name} title={a.name} />
                  <div className="photo-fields">
                    <textarea rows={2} value={notes[a.id] ?? ''} placeholder="这张照片在做什么？例如：开幕式全体合影" onChange={(e) => setNotes((n) => ({ ...n, [a.id]: e.target.value }))} data-testid={`photo-note-${i + 1}`} />
                    {g ? <small className="group-tag">在组 {letter(g)} 中</small> : <AnchorInput value={anchors[a.id] ?? ''} onChange={(v) => setAnchors((x) => ({ ...x, [a.id]: v }))} text={text} testId={`photo-anchor-${i + 1}`} />}
                  </div>
                  <button className="link" title="不使用这张照片" onClick={() => remove(a.id)}>✕</button>
                </li>
              )
            })}
          </ol>
        </>
      ) : (
        <p className="empty">还没有照片，点击「添加照片」上传</p>
      )}
    </aside>
  )
}
