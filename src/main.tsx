import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './editor/ErrorBoundary'
import { saveNow, useStore } from './editor/store'
import './styles.css'

/** 最外层兜底：任何未捕获的渲染错误都显示可恢复的提示，而不是白屏 */
function Crashed({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="crash">
      <h2>编辑器遇到错误</h2>
      <p>{error.message}</p>
      <p className="hint">你的内容已自动保存。可以先撤销最近一步操作，或重新加载页面。</p>
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
        <button onClick={() => saveNow().finally(() => location.reload())}>重新加载</button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={(error, reset) => <Crashed error={error} reset={reset} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
