// 報告工作區載入時，工作階段未保存草稿優先於 manifest。
export function resolveReportSessionDraft<T extends object>(saved: T, draft: Partial<T>): T {
  const result = { ...saved }
  for (const key of Object.keys(saved) as (keyof T)[]) {
    if (draft[key] !== undefined && draft[key] !== null) result[key] = draft[key] as T[keyof T]
  }
  return result
}

/** 按「儲存品牌」之後：Logo 的 data URL 會清掉，改用後端寫好的 logo_file 顯示。
 *  一般 refresh 不碰品牌（不洗掉未存的草稿），所以這裡要明確接回。 */
export function brandAfterSave<T extends { logo_file?: string }>(current: T, saved: Partial<T> | undefined): T {
  return saved ? { ...current, ...saved } : current
}
