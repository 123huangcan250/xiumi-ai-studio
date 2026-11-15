import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ColorModeProvider } from './editor/ColorModeControl'
import { canvasEnv, setReplayEnv } from './core/replay'
import { ErrorBoundary } from './editor/ErrorBoundary'
import { saveBeforeLeave, useStore } from './editor/store'
import './styles.css'
import './theme/fonts/fonts.css'
import './help.css'
import './color-mode.css'
import './editorial-dark.css'
import './editorial-layout.css'
import './editorial-upstream.css'

/** 最外层兜底：任何未捕获的渲染错误都显示可恢复的提示，而不是白屏 */
function Crashed({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="crash">
      <h2>编辑器遇到错误</h2>
      <p>{error.message}</p>
      <p className="hint">尚未确认内容全部保存。请先尝试撤销；重新加载前会再次确认保存结果。</p>
      <div className="row gap">
        <button
          className="primary"
          onClick={() => {
            useStore.getState().undo()
            reset()
          }}
        >
          撤销上一步并恢复
        </button>
        <button onClick={async () => { if (await saveBeforeLeave()) location.reload() }}>重新加载</button>
      </div>
    </div>
  )
}

// 编辑回放：文字测量与栅格化使用浏览器 canvas
setReplayEnv(canvasEnv(document))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={(error, reset) => <Crashed error={error} reset={reset} />}>
      <ColorModeProvider><App /></ColorModeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
