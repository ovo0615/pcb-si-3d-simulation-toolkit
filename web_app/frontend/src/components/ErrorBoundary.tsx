//
// React 在 render 期間丟出例外時會卸載整棵樹，畫面只剩空白，使用者看不到任何
// 線索、也失去整個工作階段的狀態（載入的板子、選好的 Net、分段結果…）。
// 實際發生過：S 參數分頁把 freq_ghz 傳給要 freq 的圖表，執行到 undefined.map()
// 整頁變白。
//
// 這個邊界把災情限制在出錯的那一塊，並直接把錯誤訊息秀出來，方便回報。
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** 出錯區塊的名稱，顯示在訊息裡方便定位。 */
  label?: string
}

interface State {
  error: Error | null
  stack: string
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 主控台保留完整堆疊，畫面只顯示摘要。
    console.error('[ErrorBoundary]', this.props.label || '', error, info)
    this.setState({ stack: info.componentStack || '' })
  }

  private reset = () => this.setState({ error: null, stack: '' })

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <div style={{
        padding: 16, height: '100%', overflow: 'auto',
        fontFamily: '"Calibri", "Microsoft JhengHei", sans-serif',
        color: '#ffd0d0', background: '#1b1113',
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
          {this.props.label ? `${this.props.label}顯示失敗` : '這一區顯示失敗'}
        </div>
        <div style={{ fontSize: 12.5, marginBottom: 10, lineHeight: 1.6 }}>
          其他分頁與已載入的資料仍在，可以切到別的分頁繼續操作。
          若要回報，請附上下面這段訊息。
        </div>
        <pre style={{
          fontSize: 11.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          background: '#0d0a0b', border: '1px solid #4a2a2e',
          borderRadius: 6, padding: 10, margin: 0, color: '#ffb4b4',
        }}>
          {String(error?.stack || error)}
          {stack ? '\n--- 元件堆疊 ---' + stack : ''}
        </pre>
        <button
          onClick={this.reset}
          style={{
            marginTop: 10, padding: '6px 14px', cursor: 'pointer',
            borderRadius: 6, border: '1px solid #6a3b41',
            background: '#2a181b', color: '#ffd0d0', fontSize: 12.5,
          }}
        >
          重試這一區
        </button>
      </div>
    )
  }
}
