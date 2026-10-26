// ：重開工作階段時接回上次的 S 參數結果。
//
// 串接結果原本只存在記憶體，重開後 S 參數分頁一律變灰；授權到期時板子接不回、
// 也不能重跑串接，「仍可查看既有結果」就不成立。這裡只讀上次的結果 Touchstone，
// 走檢視端點 `/api/cascade/load_external`（不查產品授權、不產生新檔）。
// 不得改成 `/api/cascade/run`：那是新分析，到期時必須被擋。
import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import { useSessionState } from './useSessionState'

export const SPARAM_VIEW_ENDPOINT = '/api/cascade/load_external'
export const SPARAM_VIEW_FIELD = 'sparamViewPath'

export type SparamViewApi = (url: string, body: { path: string }) => Promise<any>

export type SparamViewRestore = { ok: true; data: any } | { ok: false; error: unknown }

/** S 參數分頁可以點的條件（App 的分頁按鈕用同一個函式）。 */
export function sparamTabEnabled(cascadeResult: unknown): boolean {
  return Boolean(cascadeResult)
}

/** 結果變了之後要存的路徑；null＝保留現值（還原完成前不清，還原失敗下次仍可再試）。 */
export function nextSparamViewPath(cascadeResult: any, sessionReady: boolean): string | null {
  if (cascadeResult?.output_path) return String(cascadeResult.output_path)
  return sessionReady ? '' : null
}

/** 把目前 S 參數結果的路徑存進工作階段快照；換板、切模式清掉結果時一併清空。 */
export function useSparamViewPersistence(
  cascadeResult: any, sessionReady: MutableRefObject<boolean>,
): void {
  const [, setPath] = useSessionState(SPARAM_VIEW_FIELD, '')
  useEffect(() => {
    const next = nextSparamViewPath(cascadeResult, sessionReady.current)
    if (next !== null) setPath(next)
  }, [cascadeResult])
}

export function savedSparamViewPath(fields: Record<string, unknown>): string {
  const value = fields[SPARAM_VIEW_FIELD]
  return typeof value === 'string' ? value.trim() : ''
}

/** 快照沒有存結果路徑時回 null，不呼叫後端。 */
export async function restoreSparamView(
  fields: Record<string, unknown>, api: SparamViewApi,
): Promise<SparamViewRestore | null> {
  const path = savedSparamViewPath(fields)
  if (!path) return null
  try {
    return { ok: true, data: await api(SPARAM_VIEW_ENDPOINT, { path }) }
  } catch (error) {
    return { ok: false, error }
  }
}
