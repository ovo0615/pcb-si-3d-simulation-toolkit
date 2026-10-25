import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'
import MessageDialogHost from './components/MessageDialogHost'
import { currentLang, LangProvider, messagesFor } from './i18n'
import { installBetaGuard } from './betaGuard'
import { attachSession, setAttachResult } from './uiSession'
import './index.css'
import { LengthUnitProvider } from './lengthContext'
import { initializeUserPreferences } from './persistentPreferences'
import { installBackendConnection } from './backendConnection'
import BackendConnectionBanner from './components/BackendConnectionBanner'

// 關閉分頁、視窗或重新整理前交由瀏覽器確認；需先有使用者互動才會跳窗。
// 使用單一入口處理器，避免 StrictMode 或開發時重新載入重複註冊。
// 文字依目前畫面語言（多數瀏覽器只顯示自己的固定文字，仍照語言給）。
window.onbeforeunload = (event: BeforeUnloadEvent) => {
  event.preventDefault()
  event.returnValue = messagesFor(currentLang()).shell.leaveConfirm
}
installBackendConnection(window)

// 送出 Beta 選項前的提示：包住 fetch 一次，所有面板與元件共用。

// 先讀回上次的工作階段，各欄位的初值才拿得到快照裡的值；後端沒回應
// 最多等幾秒就照常開窗（attachSession 不丟例外）。
void initializeUserPreferences(window).then(() => {
  installBetaGuard(window)
  return attachSession()
}).then(result => {
  setAttachResult(result)
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LangProvider>
        <ErrorBoundary label={t => t.shell.rootLabel}>
          <BackendConnectionBanner />
          <LengthUnitProvider><App /></LengthUnitProvider>
        </ErrorBoundary>
        {/* 訊息視窗放在 ErrorBoundary 外：某一區顯示失敗時，排著的訊息仍看得到。 */}
        <MessageDialogHost />
      </LangProvider>
    </React.StrictMode>,
  )
})
