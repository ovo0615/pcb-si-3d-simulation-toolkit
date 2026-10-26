/** K2：來源不可用時保留計時，但不可把缺資料畫成零輪次。 */
export function solverProgress(
  monitor: { source?: string } | null | undefined,
  phase: string,
  unavailable: string,
): { phase: string; showCounts: boolean } {
  const available = monitor?.source !== 'unavailable'
  return { phase: available ? phase : unavailable, showCounts: available }
}

/** K2 的重試欄位；profile 已接手時不顯示監看失敗的警告。 */
export function monitorRetry(monitor: {
  source?: string; retry_count?: number; retry_in_seconds?: number
} | null | undefined): { count: number; seconds: number } | null {
  if (monitor?.source !== 'unavailable' || !Number.isFinite(monitor.retry_count)
      || !(Number(monitor.retry_count) > 0)) return null
  return {
    count: Math.floor(Number(monitor.retry_count)),
    seconds: Number.isFinite(monitor.retry_in_seconds)
      ? Math.max(0, Math.ceil(Number(monitor.retry_in_seconds))) : 0,
  }
}
