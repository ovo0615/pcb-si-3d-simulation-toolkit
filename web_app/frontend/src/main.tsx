import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import { currentLang, LangProvider, messagesFor } from './i18n'
import { installBetaGuard } from './betaGuard'
import './index.css'

// 關閉分頁、視窗或重新整理前交由瀏覽器確認；需先有使用者互動才會跳窗。
// 使用單一入口處理器，避免 StrictMode 或開發時重新載入重複註冊。
// 文字依目前畫面語言（多數瀏覽器只顯示自己的固定文字，仍照語言給）。
window.onbeforeunload = (event: BeforeUnloadEvent) => {
  event.preventDefault()
  event.returnValue = messagesFor(currentLang()).shell.leaveConfirm
}

// 送出 Beta 選項前的提示（#0131）：包住 fetch 一次，所有面板與元件共用。
installBetaGuard(window)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LangProvider>
      <ErrorBoundary label={t => t.shell.rootLabel}>
        <App />
      </ErrorBoundary>
    </LangProvider>
  </React.StrictMode>,
)
