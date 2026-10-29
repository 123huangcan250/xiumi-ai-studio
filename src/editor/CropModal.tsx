import { useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { api, type Asset } from './api'
import { Modal } from './Modal'
import { useStore } from './store'

const RATIOS: [string, number | undefined][] = [
  ['自由', undefined],
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['公众号封面 2.35:1', 2.35],
]

export function CropModal({ asset, onClose, onDone }: { asset: Asset; onClose: () => void; onDone: (a: Asset) => void }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [aspect, setAspect] = useState<number | undefined>(4 / 3)
  const [area, setArea] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={`裁剪：${asset.name}`} onClose={onClose} width={720}>
      <div className="crop-area">
        <Cropper
          image={`/media/${asset.file}`}
          crop={crop}
          zoom={zoom}
          aspect={aspect ?? asset.width / asset.height}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={(_, px) => setArea(px)}
          objectFit="contain"
        />
      </div>
      <div className="row gap">
        {RATIOS.map(([label, r]) => (
          <button key={label} className={aspect === r ? 'on' : ''} onClick={() => setAspect(r)}>
            {label}
          </button>
        ))}
        <input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
      </div>
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button
          className="primary"
          disabled={!area || busy}
          onClick={async () => {
            setBusy(true)
            try {
              const a = await api.cropAsset(asset.id, area!)
              useStore.getState().notify('已另存为新素材（原图保留）')
              onDone(a)
            } catch (e: any) {
              useStore.getState().notify(e.message, 'error')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? '处理中…' : '裁剪并另存'}
        </button>
      </div>
    </Modal>
  )
}
