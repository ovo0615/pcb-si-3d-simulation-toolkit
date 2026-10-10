import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// 關閉分頁、視窗或重新整理前交由瀏覽器確認；需先有使用者互動才會跳窗。
// 使用單一入口處理器，避免 StrictMode 或開發時重新載入重複註冊。
window.onbeforeunload = (event: BeforeUnloadEvent) => {
  event.preventDefault()
  event.returnValue = '離開將關閉工具介面。'
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary label="工具介面">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
