//
// React 在 render 期間丟出例外時會卸載整棵樹，畫面只剩空白，使用者看不到任何
// 線索、也失去整個工作階段的狀態（載入的板子、選好的 Net、分段結果…）。
// 實際發生過：S 參數分頁把 freq_ghz 傳給要 freq 的圖表，執行到 undefined.map
// 整頁變白。
//
// 這個邊界把災情限制在出錯的那一塊，並直接把錯誤訊息秀出來，方便回報。
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useT } from '../i18n'
import type { Messages } from '../i18n'

/** 區塊名稱：字串，或從字典取（：切換語言時跟著換）。 */
type Label = string | ((t: Messages) => string)

interface Props {
  children: ReactNode
  /** 出錯區塊的名稱，顯示在訊息裡方便定位。 */
  label?: Label
}

interface State {
  error: Error | null
  stack: string
}

/** 出錯後的畫面。拆成函式元件才拿得到語言（class 元件不能用 hook）。 */
function Fallback({ label, onRetry }: {
  label?: Label
  error: Error
  stack: string
  onRetry: () => void
}) {
  const { t } = useT()
  const e = t.errorBoundary
  const name = typeof label === 'function' ? label(t) : label
  return (
    <div style={{
      padding: 16, height: '100%', overflow: 'auto',
      fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
      color: '#ffd0d0', background: '#1b1113',
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
        {name ? e.failedWithLabel(name) : e.failed}
      </div>
      <div style={{ fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 }}>
        {e.stillThere}
        {' '}{e.report}
      </div>
      <button
        onClick={onRetry}
        style={{
          marginTop: 10, padding: '6px 14px', cursor: 'pointer',
          borderRadius: 6, border: '1px solid #6a3b41',
          background: '#2a181b', color: '#ffd0d0', fontSize: 12.5,
        }}
      >
        {e.retry}
      </button>
    </div>
  )
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 主控台保留完整堆疊，畫面只顯示摘要。
    const label = typeof this.props.label === 'string' ? this.props.label : ''
    console.error('[ErrorBoundary]', label, error, info)
    this.setState({ stack: info.componentStack || '' })
  }

  private reset = () => this.setState({ error: null, stack: '' })

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children
    return <Fallback label={this.props.label} error={error} stack={stack} onRetry={this.reset} />
  }
}
