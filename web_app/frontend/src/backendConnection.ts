import { restartHint } from './installKind'
import { userError } from './userMessages'
import type { Lang } from './i18n/lang'
import { messagesFor } from './i18n/catalog'

export const BACKEND_CONNECTION_EVENT = 'pcbsi-backend-connection'
let available = true
export function backendAvailable(): boolean { return available }
export function backendUnavailableText(lang: Lang): string {
  return messagesFor(lang).backendConnection.unavailable(restartHint(lang))
}

/** 僅本機 API 的傳輸中斷代表失聯；HTTP 業務錯誤仍交給原呼叫端。 */
export function connectionFetch(fetchImpl: typeof fetch, notify: (available: boolean) => void): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const base = typeof location === 'undefined' ? 'http://localhost' : location.origin
    const target = new URL(url, base)
    const api = target.origin === base && target.pathname.startsWith('/api/')
    let response: Response
    try {
      response = await fetchImpl(input, init)
    } catch (error) {
      if (!api || !(error instanceof TypeError)) throw error
      notify(false)
      throw Object.assign(userError(backendUnavailableText('zh-TW'), backendUnavailableText('en')),
        { code: 'session.backend_unavailable' })
    }
    if (api) {
      // 收尾中的心跳會回 503；其他端點的 503 可能只是暫時忙碌。
      notify(!(target.pathname === '/api/ui_session/heartbeat' && response.status === 503))
    }
    return response
  }
}

export function installBackendConnection(target: Window): void {
  target.fetch = connectionFetch(target.fetch.bind(target), value => {
    if (available === value) return
    available = value
    target.dispatchEvent(new Event(BACKEND_CONNECTION_EVENT))
  })
}
