// 關窗保存／放棄工作階段：前端這一側的登錄表、自動保存與後端呼叫。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 要「下次開啟回到一模一樣的畫面」，每個使用者輸入的欄位都登錄在這裡
// （useSessionState 自動登錄）。保存時收集全部欄位寫成一份快照；開窗時
// 先讀回快照，各欄位的初值直接取快照裡的值，載入板子之後再整批套用一次
// （載入流程會重設網路、輸出路徑等欄位）。
//
// 不放結果與幾何（預覽、S 參數、眼圖）：那些從檔案重建，快照只放設定與畫面。
// 本檔不 import React，Node 測試直接跑。

import { displayLengthPreference } from './lengthUnits'
import { flushUserPreferences } from './persistentPreferences'

export const SESSION_DATA_VERSION = 1

const sessionValue = (key: string, value: unknown): unknown =>
  key === 'displayLengthUnit' ? displayLengthPreference(value) : value

/** 後端 /api/ui_session/attach 的回應。 */
export interface AttachResult {
  status: 'none' | 'ok' | 'corrupt' | 'unsupported' | 'offline'
  snapshot?: {
    revision: number
    saved_at: string
    board?: { path?: string; original_path?: string; is_cut?: boolean; segment_ready?: boolean }
    data: SessionData
  }
  error?: string
  set_aside?: string
  jobs?: { key: string; label: string; label_en?: string; detail?: string; detail_en?: string }[]
  was_detached?: boolean
  board_now?: { path?: string; is_cut?: boolean; segment_ready?: boolean; loaded?: boolean }
}

export interface SessionData {
  version: number
  fields: Record<string, unknown>
}

// ── 欄位登錄表 ──────────────────────────────────────────────────────────────

interface Field {
  get: () => unknown
  set: (value: unknown) => void
  /** 判斷讀回的值能不能用的樣本（欄位的初值）。 */
  sample: unknown
}

const registry = new Map<string, Field>()
/** 已卸載元件的最後值（見 registerSessionField 的取消函式）。 */
const retained = new Map<string, unknown>()
let restoredFields: Record<string, unknown> | null = null
const listeners = new Set<() => void>()

/** 讀回的值和欄位初值同型別才採用：舊版快照、手改過的檔案不能把欄位弄壞。 */
export function compatible(sample: unknown, value: unknown): boolean {
  if (value === undefined) return false
  if (sample === null || sample === undefined) return true
  if (Array.isArray(sample)) return Array.isArray(value)
  if (typeof sample === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
  return typeof value === typeof sample
}

/** 開窗時讀回的快照（只設一次）；之後各欄位初值從這裡取。 */
export function setRestoredFields(fields: Record<string, unknown> | null): void {
  restoredFields = fields && typeof fields === 'object'
    ? Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, sessionValue(key, value)])) : null
}

export function hasRestoredFields(): boolean {
  return restoredFields !== null
}

/** 欄位初值：快照裡有同型別的值就用它，否則用 fallback。 */
export function restoredFieldValue<T>(key: string, fallback: T): T {
  // 這次開窗後收起來又打開的面板：用它收起來前的值，比快照新。
  if (retained.has(key)) {
    const value = retained.get(key)
    return compatible(fallback, value) ? (value as T) : fallback
  }
  if (!restoredFields || !(key in restoredFields)) return fallback
  const value = restoredFields[key]
  return compatible(fallback, value) ? (value as T) : fallback
}

/** 登錄一個要保存的欄位；回傳取消登錄的函式。同一個鍵同時登錄兩次是寫錯了
 *  （例如同一個元件開了兩份）：後登錄的接手並在主控台警告，不讓整個畫面當掉。 */
export function registerSessionField(key: string, get: () => unknown,
                                     set: (value: unknown) => void, sample: unknown): () => void {
  if (registry.has(key)) console.warn(`Duplicate session field key: ${key}`)
  const field = { get, set, sample }
  registry.set(key, field)
  retained.delete(key)
  return () => {
    if (registry.get(key) !== field) return
    // 面板收起來（元件卸載）時記下最後的值：關窗時那個面板不一定開著，
    // 它的設定仍要跟著存；下次打開面板由 restoredFieldValue 讀回。
    retained.set(key, field.get())
    registry.delete(key)
  }
}

export function registeredSessionKeys(): string[] {
  return [...registry.keys()].sort()
}

/** 目前所有欄位的值（保存用）。值必須能存成 JSON。 */
export function collectSessionFields(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  // 這次還沒打開過的面板：沿用快照裡的值，不能因為沒打開就把它的設定丟掉。
  if (restoredFields) {
    for (const [key, value] of Object.entries(restoredFields)) {
      if (!registry.has(key) && value !== undefined) out[key] = value
    }
  }
  for (const [key, value] of retained) {
    if (!registry.has(key) && value !== undefined) out[key] = value
  }
  for (const [key, field] of registry) {
    const value = field.get()
    if (value !== undefined) out[key] = value
  }
  return out
}

/** 把快照裡的值整批套回已登錄的欄位（載入板子之後用）。回傳實際套用的鍵。 */
export function applySessionFields(fields: Record<string, unknown>): string[] {
  const applied: string[] = []
  for (const [key, field] of registry) {
    if (!(key in fields)) continue
    const value = sessionValue(key, fields[key])
    if (!compatible(field.sample, value)) continue
    field.set(value)
    applied.push(key)
  }
  return applied
}

export function sessionData(): SessionData {
  return { version: SESSION_DATA_VERSION, fields: collectSessionFields() }
}

/** 欄位改變時呼叫（useSessionState 自動呼叫）；自動保存聽這個。 */
export function notifySessionChange(): void {
  for (const listener of listeners) listener()
}

export function onSessionChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 測試用：清掉登錄表與讀回的快照。 */
export function resetSessionRegistry(): void {
  registry.clear()
  retained.clear()
  listeners.clear()
  restoredFields = null
}

// ── 自動保存（防抖）─────────────────────────────────────────────────────────

export interface Autosaver {
  markDirty: () => void
  /** 立刻保存還沒存的變更；沒有變更就什麼都不做。 */
  flush: () => Promise<void>
  /** 停止（關窗流程開始後就不再自動保存，免得蓋掉「放棄」）。 */
  stop: () => void
  /** 關窗沒成功、視窗留著：恢復自動保存（之前累積的變更下一次一起存）。 */
  resume: () => void
  readonly lastError: string
}

export function createAutosaver(
  save: () => Promise<void>,
  delayMs: number,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): Autosaver {
  let dirty = false
  let stopped = false
  let handle: unknown = null
  let running: Promise<void> | null = null
  let lastError = ''

  const run = async (): Promise<void> => {
    if (handle !== null) { timers.clear(handle); handle = null }
    if (running) await running
    if (!dirty || stopped) return
    dirty = false
    running = (async () => {
      try {
        await save()
        lastError = ''
      } catch (error) {
        dirty = true   // 沒存成功：下一次變更（或關窗）再試，不假裝存好了
        lastError = error instanceof Error ? error.message : String(error)
      }
    })()
    try { await running } finally { running = null }
  }

  return {
    markDirty() {
      if (stopped) return
      dirty = true
      if (handle !== null) timers.clear(handle)
      handle = timers.set(() => { handle = null; void run() }, delayMs)
    },
    flush: run,
    stop() {
      stopped = true
      if (handle !== null) { timers.clear(handle); handle = null }
    },
    resume() {
      stopped = false
      if (dirty) handle = timers.set(() => { handle = null; void run() }, delayMs)
    },
    get lastError() { return lastError },
  }
}

// ── 後端呼叫 ────────────────────────────────────────────────────────────────

function makeClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* 舊環境沒有 randomUUID */ }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** 這個頁面（視窗、分頁）的身分；最後連上的那一個才能寫快照。 */
export const CLIENT_ID = makeClientId()

async function postJson(url: string, method: string, body: unknown,
                        keepalive = false): Promise<any> {
  const res = await fetch(url, {
    method, keepalive,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = null }
  if (!res.ok) {
    const detail = data && typeof data.detail === 'string' ? data.detail : text.slice(0, 200)
    throw Object.assign(new Error(`HTTP ${res.status}${detail ? `: ${detail}` : ''}`),
                        { status: res.status })
  }
  return data
}

/** 開窗時：取回快照並成為擁有者。後端沒回應就當成沒有快照（照常開窗）。 */
export async function attachSession(timeoutMs = 4000): Promise<AttachResult> {
  try {
    const result = await Promise.race([
      postJson('/api/ui_session/attach', 'POST', { client_id: CLIENT_ID }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ])
    return result as AttachResult
  } catch (error) {
    return { status: 'offline', error: error instanceof Error ? error.message : String(error) }
  }
}

/** 心跳的間隔。後端 45 秒沒收到就當成視窗不在（ui_session.CLIENT_STALE_S）。 */
export const HEARTBEAT_MS = 15000

/** 告訴後端「這個視窗還開著」：背景工作做完時，有視窗連著就不收尾。 */
export function sendSessionHeartbeat(): Promise<any> {
  return postJson('/api/ui_session/heartbeat', 'POST', { client_id: CLIENT_ID })
}

export function putSessionSnapshot(data: SessionData, keepalive = false): Promise<any> {
  return postJson('/api/ui_session/snapshot', 'PUT', { client_id: CLIENT_ID, data }, keepalive)
}

/** 關窗對話框：保存（帶最新狀態）或放棄。回傳 keep_backend＝還有工作在跑。 */
export async function closeSession(action: 'save' | 'discard',
                                   data?: SessionData): Promise<{ keep_backend: boolean; preferences_saved?: boolean }> {
  let preferencesSaved = true
  if (action === 'save') {
    try { await flushUserPreferences() } catch { preferencesSaved = false }
  }
  const body: Record<string, unknown> = { client_id: CLIENT_ID, action }
  if (action === 'save' && data) body.data = data
  const result = await postJson('/api/ui_session/close', 'POST', body)
  return { keep_backend: result?.keep_backend === true,
    ...(!preferencesSaved ? { preferences_saved: false } : {}) }
}

// ── 開窗時讀回的結果（main.tsx 寫入、App 讀取）─────────────────────────────

let attachResult: AttachResult = { status: 'none' }

export function setAttachResult(result: AttachResult): void {
  attachResult = result
  setRestoredFields(result.status === 'ok' && result.snapshot?.data?.fields
    ? result.snapshot.data.fields : null)
}

export function getAttachResult(): AttachResult {
  return attachResult
}
