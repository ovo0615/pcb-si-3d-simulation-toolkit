// Ansys 授權對照與目前可用數量（ADR-0062）。
//
// 後端 `/api/ansys-license/status` 回傳每個會用到 Ansys 的功能需要哪些 license
// feature、現在各有幾個空位。所有面板共用同一份結果：一個 store、每 60 秒更新
// 一次（後端自己再快取 30 秒），不會每顆按鈕各自去打授權伺服器。
//
// 這裡只負責「按鈕變灰、旁邊寫需要什麼」。真正的關卡在後端：前端沒擋到、
// 或檢查之後授權被別人拿走，後端仍會回「需要 X 授權，目前沒有可用的」。
import { useSyncExternalStore } from 'react'

export type LicenseState = 'available' | 'unavailable' | 'unknown'

export interface FeatureRow {
  feature: string
  state: LicenseState
  free: number | null
  issued: number | null
  in_use: number | null
}

export interface FunctionStatus {
  function: string
  label: string
  product: string
  state: LicenseState
  message: string
  required: string[]
  optional_features: string[]
  features: FeatureRow[]
  optional: FeatureRow[]
  evidence: string
}

export interface LicenseStatus {
  query: {
    status: 'ok' | 'unknown'
    reason: string
    partial?: boolean
    servers: { server: string; up: boolean; error: string }[]
    checked_at: number
  }
  cache_seconds: number
  functions: Record<string, FunctionStatus>
  feature_counts: Record<string, { issued: number | null; in_use: number | null; free: number | null } | null>
}

/** 會用到 Ansys 授權的功能鍵（與後端 license_map.FUNCTIONS 相同）。 */
export type AnsysFunction =
  | 'siwave_solve' | 'hfss3dlayout_solve' | 'hfss3dlayout_export' | 'q2d_solve'
  | 'circuit_tdr' | 'circuit_export' | 'circuit_quickeye' | 'model_check'
  | 'ami_channel' | 'multi_lane' | 'spisim_com' | 'odbpp_import'

type Snapshot = { status: LicenseStatus | null; error: string; loading: boolean }

let snapshot: Snapshot = { status: null, error: '', loading: false }
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
const REFRESH_MS = 60_000

function emit(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next }
  listeners.forEach(listener => listener())
}

export async function refreshLicenseStatus(force = false): Promise<void> {
  emit({ loading: true })
  try {
    const response = await fetch(`/api/ansys-license/status${force ? '?refresh=true' : ''}`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    emit({ status: await response.json() as LicenseStatus, error: '', loading: false })
  } catch (error) {
    // 連授權狀態都拿不到：不能當成有，也不能當成沒有——按鈕不擋，提示看不到狀態。
    // 舊的 status 一起丟掉：留著的話，上一次的「沒有空位」會繼續把按鈕擋住
    // （repo 審查第 9 輪）。
    emit({ status: null, error: `讀不到授權狀態：${String(error)}`, loading: false })
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshLicenseStatus()
    timer = setInterval(() => void refreshLicenseStatus(), REFRESH_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function useAnsysLicense(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot)
}

/** 這些功能有沒有被授權擋住。擋住時回傳要顯示的原因，否則回 null。 */
export function licenseBlock(status: LicenseStatus | null, functions: AnsysFunction[]): string | null {
  if (!status) return null
  for (const key of functions) {
    const item = status.functions[key]
    if (item && item.state === 'unavailable') return item.message
  }
  return null
}

/** 按鈕旁邊的一行字：需要哪些授權、現在狀況。 */
export function licenseSummary(status: LicenseStatus | null, functions: AnsysFunction[]): {
  text: string
  state: LicenseState | 'loading'
} {
  if (!status) return { text: '需要 Ansys 授權（讀取中）', state: 'loading' }
  const items = functions.map(key => status.functions[key]).filter(Boolean)
  const features = Array.from(new Set(items.flatMap(item => item.required)))
  const state: LicenseState = items.some(item => item.state === 'unavailable') ? 'unavailable'
    : items.some(item => item.state === 'unknown') ? 'unknown' : 'available'
  const counts = features.map(name => {
    const c = status.feature_counts[name]
    return c && c.free !== null ? `${name}（可用 ${c.free}/${c.issued}）` : name
  })
  const lead = state === 'unavailable' ? '授權不足'
    : state === 'unknown' ? '無法確認授權' : '需要授權'
  return { text: `${lead}：${counts.join('、')}`, state }
}

export const LICENSE_COLORS: Record<LicenseState | 'loading', string> = {
  available: '#3a9d4a',
  unavailable: '#e04848',
  unknown: '#d08a1a',
  loading: '#8a94a3',
}
