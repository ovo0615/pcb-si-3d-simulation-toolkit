// 求解核心數：以使用者偏好保存，獨立於專案與工作階段；舊快照只作首次遷移。
//
// 沒有 HPC 授權的客戶最多只能用 4 核；鎖死 12 核等於完全不能求解。

export const DEFAULT_SOLVER_CORES = 12
export const SOLVER_CORES_SESSION_KEY = 'solverCores'
export const SOLVER_CORES_PREFERENCE_KEY = 'pcbsi.solverCores.v1'

export const isSolverCoresPreference = (value: string) => parseSolverCores(value) !== null

/** 輸入框文字 → 核心數；不是 1 以上的整數回 null，送出前擋下、不默默改值。 */
export function parseSolverCores(text: unknown): number | null {
  const value = String(text ?? '').trim()
  if (!/^\d+$/.test(value)) return null
  const cores = Number(value)
  return Number.isSafeInteger(cores) && cores >= 1 ? cores : null
}
