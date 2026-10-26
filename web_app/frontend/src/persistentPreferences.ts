// 使用者偏好與同意由後端持久保存，跨程式包、埠號與瀏覽器 origin；localStorage 作快取。
import { currentLang, messagesFor } from './i18n/catalog'
import { betaFeaturesForRequest } from './featureTiers'

const ENDPOINT = '/api/user-preferences'
const WORK_SOURCES_PREFIX = 'pcbsi.report.work-sources.v1:'
const CONSENT_KEYS = new Set(['pcbsi.native-library-terms.v1', 'pcbsi.betaNotice.v1'])
const KEYS = new Set([
  'pcbsi.lang.v1', 'pcbsi.reportLocale.v1', 'pcbsi.split.main.v1', 'pcbsi.split.log.v1',
  'pcbsi.enabledTasks.v1', 'pcbsi.native-library-terms.v1', 'pcbsi.betaNotice.v1', 'pcbsi.solverCores.v1',
])
export const persistentPreferenceKey = (key: string) =>
  KEYS.has(key) || (key.startsWith(WORK_SOURCES_PREFIX) && key.length > WORK_SOURCES_PREFIX.length)

type PreferenceWindow = Pick<Window, 'localStorage' | 'fetch' | 'addEventListener' | 'removeEventListener'>
export interface PreferenceAdapter { flush: () => Promise<void>; dispose: () => void }
let active: PreferenceAdapter | null = null
export const flushUserPreferences = () => active?.flush() ?? Promise.resolve()

const saveFailure = () => new Error(messagesFor(currentLang()).userPreferences.saveError)

async function consentRequest(input: RequestInfo | URL, init?: RequestInit): Promise<boolean> {
  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null
  const path = new URL(request?.url || String(input), 'http://127.0.0.1').pathname
  const method = String(init?.method || request?.method || 'GET').toUpperCase()
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false
  // B03 混合求解器串接的確認由畫面判定，請求內容無法推導。
  if (/^\/api\/models\/[^/]+\/trust$/.test(path) || path === '/api/cascade/run') return true
  let body: unknown = null
  try {
    if (typeof init?.body === 'string') body = JSON.parse(init.body)
    else if (request && init?.body === undefined) body = await request.clone().json()
  } catch { /* 沿用 Beta 登錄表對無 JSON 的判斷。 */ }
  return betaFeaturesForRequest(method, path, body).length > 0
}

export async function initializeUserPreferences(win: PreferenceWindow = window): Promise<PreferenceAdapter> {
  const rawFetch = win.fetch.bind(win)
  const noop: PreferenceAdapter = { flush: async () => {}, dispose: () => {} }
  let storage: Storage
  try { storage = win.localStorage } catch {
    // 瀏覽器拒絕快取時仍保留查看／保存，不能把未記錄的同意當成已保存。
    const previous = win.fetch
    const guarded: typeof fetch = async (input, init) => {
      if (await consentRequest(input, init)) throw saveFailure()
      return rawFetch(input, init)
    }
    const adapter: PreferenceAdapter = {
      flush: async () => { throw saveFailure() },
      dispose: () => {
        if (win.fetch === guarded) win.fetch = previous
        if (active === adapter) active = null
      },
    }
    win.fetch = guarded
    active = adapter
    return adapter
  }
  const prototype = Object.getPrototypeOf(storage) as Storage
  const originalSet = prototype.setItem
  const originalRemove = prototype.removeItem
  const originalClear = prototype.clear
  const dirty = new Map<string, string | null>()
  const pendingConsents = new Set<string>()
  let storageHealthy = true
  let inflight: Promise<void> | null = null
  let disposed = false

  const drain = (): Promise<void> => {
    if (inflight) return inflight
    inflight = (async () => {
      while (dirty.size) {
        const changes: Record<string, string | null> = {}
        for (const [key, value] of dirty) {
          const candidate = { ...changes, [key]: value }
          if (Object.keys(changes).length && (Object.keys(candidate).length > 128
              || new TextEncoder().encode(JSON.stringify({ changes: candidate })).length > 900000)) break
          changes[key] = value
        }
        for (const key of Object.keys(changes)) dirty.delete(key)
        try {
          const body = JSON.stringify({ changes })
          const response = await rawFetch(ENDPOINT, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
            keepalive: new TextEncoder().encode(body).length <= 60000,
            signal: AbortSignal.timeout(5000),
          })
          if (!response.ok) throw saveFailure()
          for (const key of Object.keys(changes)) if (!dirty.has(key)) pendingConsents.delete(key)
        } catch {
          for (const [key, value] of Object.entries(changes)) if (!dirty.has(key)) dirty.set(key, value)
          throw saveFailure()
        }
      }
    })().finally(() => { inflight = null })
    return inflight
  }
  const queue = (key: string, value: string | null) => {
    if (disposed || !persistentPreferenceKey(key)) return
    dirty.set(key, value)
    if (CONSENT_KEYS.has(key)) pendingConsents.add(key)
    void drain().catch(() => console.warn('User preferences have not been persisted.'))
  }
  const set: Storage['setItem'] = function (this: Storage, key, value) {
    try { originalSet.call(this, key, value) } catch (error) {
      if (this === storage && CONSENT_KEYS.has(String(key))) storageHealthy = false
      throw error
    }
    if (this === storage) queue(String(key), String(value))
  }
  const remove: Storage['removeItem'] = function (this: Storage, key) {
    originalRemove.call(this, key)
    if (this === storage) queue(String(key), null)
  }
  const clear: Storage['clear'] = function (this: Storage) {
    const keys = this === storage ? Array.from({ length: storage.length }, (_, i) => storage.key(i)) : []
    originalClear.call(this)
    for (const key of keys) if (key) queue(key, null)
  }

  // 已知的後端值（包含刪除標記）優先，舊 origin 只補後端從未見過的鍵。
  let known: Record<string, string | null> = {}
  let snapshotLoaded = false
  try {
    const response = await rawFetch(ENDPOINT, { signal: AbortSignal.timeout(5000) })
    // 靜態預覽或舊後端沒有此介面，維持原快取；不宣稱已持久化。
    if (response.status === 404) return noop
    if (!response.ok) throw saveFailure()
    const payload = await response.json()
    if (!payload.values || typeof payload.values !== 'object' || Array.isArray(payload.values)) throw saveFailure()
    known = payload.values
    if (Object.entries(known).some(([key, value]) => persistentPreferenceKey(key)
        && value !== null && typeof value !== 'string')) throw saveFailure()
    for (const [key, value] of Object.entries(known)) {
      if (!persistentPreferenceKey(key)) continue
      if (value === null) originalRemove.call(storage, key)
      else if (typeof value === 'string') originalSet.call(storage, key, value)
    }
    snapshotLoaded = true
  } catch {
    console.warn('Persistent user preferences could not be loaded.')
    // 讀取失敗不能把舊 origin 的同意重新遷移到後端，先讓使用者重新確認。
    for (const key of CONSENT_KEYS) {
      try { originalRemove.call(storage, key) } catch { storageHealthy = false }
    }
  }
  for (let i = 0; snapshotLoaded && i < storage.length; i++) {
    const key = storage.key(i)
    if (key && persistentPreferenceKey(key) && !Object.prototype.hasOwnProperty.call(known, key)) {
      dirty.set(key, storage.getItem(key))
      if (CONSENT_KEYS.has(key)) pendingConsents.add(key)
    }
  }
  prototype.setItem = set
  prototype.removeItem = remove
  prototype.clear = clear

  const fetchBefore = win.fetch
  const guarded: typeof fetch = async (input, init) => {
    if (await consentRequest(input, init)) {
      if (!storageHealthy) throw saveFailure()
      if (pendingConsents.size) await adapter.flush()
    }
    return rawFetch(input, init)
  }
  const pagehide = () => { void adapter.flush().catch(() => {}) }
  const adapter: PreferenceAdapter = {
    flush: async () => { if (dirty.size || inflight) await drain() },
    dispose: () => {
      disposed = true
      if (prototype.setItem === set) prototype.setItem = originalSet
      if (prototype.removeItem === remove) prototype.removeItem = originalRemove
      if (prototype.clear === clear) prototype.clear = originalClear
      if (win.fetch === guarded) win.fetch = fetchBefore
      win.removeEventListener('pagehide', pagehide)
      if (active === adapter) active = null
    },
  }
  win.fetch = guarded
  win.addEventListener('pagehide', pagehide)
  active = adapter
  try { await adapter.flush() } catch { console.warn('Legacy preferences are pending persistence.') }
  return adapter
}
