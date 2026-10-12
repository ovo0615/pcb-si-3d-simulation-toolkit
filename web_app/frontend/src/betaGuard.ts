// 送出前的 Beta 提示（#0131）。
//
// 用到 Beta 選項的請求散在主畫面與十幾個元件，各自的 fetch 包裝都不同；逐一改
// 一定會漏。這裡在啟動時包住 window.fetch 一次：POST 到登錄檔列出的 Beta 端點
// （或內容符合，例如 PhiPlus）時，先彙總本次用到的 Beta 項目請使用者確認。
//
// * 每個分級版本只問一次；按「取消」就不送出、不改任何設定，呼叫端照一般錯誤
//   顯示 `declined` 訊息。
// * 它**不取代**原有的覆寫、刪層、DLL 信任、授權與求解確認——那些照舊各自問。
// * 後端另外由實際請求推導並記錄（直接呼叫 API 也算），不靠這裡。

import {
  BETA_NOTICE_STORAGE_KEY,
  acknowledgeBetaNotice,
  betaFeaturesForRequest,
  formatBetaNotice,
  pendingBetaNotice,
  type FeatureTierMessages,
} from './featureTiers'
import { currentLang, messagesFor } from './i18n/catalog'

export interface BetaGuardDeps {
  confirm: (text: string) => boolean
  read: () => string | null
  write: (value: string) => void
  messages: () => FeatureTierMessages
}

export class BetaDeclinedError extends Error {
  readonly code = 'beta_declined'
}

function describe(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string; body: unknown } {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const url = request ? request.url : String(input)
  const method = init?.method ?? request?.method ?? 'GET'
  let body: unknown = null
  if (typeof init?.body === 'string') {
    try { body = JSON.parse(init.body) } catch { body = null }
  }
  return { url, method, body }
}

function readAcked(deps: BetaGuardDeps): unknown {
  try {
    return JSON.parse(deps.read() || 'null')
  } catch {
    return null
  }
}

/** 這些 Beta 項目還沒確認過就問；回傳 false＝使用者取消。 */
export function confirmBetaWith(ids: readonly string[], deps: BetaGuardDeps): boolean {
  if (!ids.length) return true
  const acked = readAcked(deps)
  const pending = pendingBetaNotice(ids, acked)
  if (!pending.length) return true
  if (!deps.confirm(formatBetaNotice(pending, deps.messages()))) return false
  try {
    deps.write(JSON.stringify(acknowledgeBetaNotice(pending, acked)))
  } catch {
    // 存不了（無痕、配額滿）就下次再問；不影響這次送出。
  }
  return true
}

export function guardFetch(fetchImpl: typeof fetch, deps: BetaGuardDeps): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, method, body } = describe(input, init)
    if (!confirmBetaWith(betaFeaturesForRequest(method, url, body), deps)) {
      return Promise.reject(new BetaDeclinedError(deps.messages().declined))
    }
    return fetchImpl(input, init)
  }
}

let installedDeps: BetaGuardDeps | null = null

/**
 * 請求本身看不出來、要看畫面狀態才知道的 Beta（例如分段求解器混用時的串接
 * 頻點內插 B03）：呼叫端在送出前自己問。和 fetch 守門共用同一份「已確認」紀錄。
 */
export function confirmBetaUse(ids: readonly string[]): boolean {
  return installedDeps ? confirmBetaWith(ids, installedDeps) : true
}

/** main.tsx 啟動時呼叫一次。 */
export function installBetaGuard(win: Window): void {
  if (installedDeps) return
  installedDeps = {
    confirm: text => win.confirm(text),
    read: () => win.localStorage.getItem(BETA_NOTICE_STORAGE_KEY),
    write: value => win.localStorage.setItem(BETA_NOTICE_STORAGE_KEY, value),
    messages: () => messagesFor(currentLang()).featureTier,
  }
  win.fetch = guardFetch(win.fetch.bind(win), installedDeps)
}
