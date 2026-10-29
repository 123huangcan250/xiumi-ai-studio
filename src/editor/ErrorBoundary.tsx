import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 渲染出错时显示的内容；不传则使用默认提示 */
  fallback?: (error: Error, reset: () => void) => ReactNode
  /** 内容变化时自动重置（例如模块数据被修复后） */
  resetKey?: unknown
}

/** 捕获子树渲染错误，避免一个模块的数据问题导致整个页面白屏 */
export class ErrorBoundary extends Component<Props, { error: Error | null; key: unknown }> {
  state = { error: null as Error | null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: Props, state: { error: Error | null; key: unknown }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null
  }

  componentDidCatch(error: Error) {
    console.error('[XIUMI] render error:', error)
  }

  reset = () => this.setState({ error: null })

  render() {
    if (!this.state.error) return this.props.children
    return this.props.fallback ? this.props.fallback(this.state.error, this.reset) : <div className="render-error">渲染出错：{this.state.error.message}</div>
  }
}
