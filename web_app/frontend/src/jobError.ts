// 背景工作輪詢的「致命錯誤」標記。
//
// 匯入、裁切、建立 Port、疊構更換、背鑽都是「送出 → 每隔幾秒問一次狀態」的
// 迴圈，而迴圈裡同時有兩種錯誤：
//
//  * 暫時性的（後端正忙、連線抖一下）——再問幾次就好，不該把整趟做掉；
//  * 終局的（`status === 'error'`）——工作已經死了，再問一萬次也不會變。
//
// 原本兩者是靠「錯誤訊息裡有沒有出現某個字串」分辨的（`String(error)
// .includes('裁切工作失敗')`）。那條線綁在後端的措辭上：`/api/load/status`
// 回的 `error` 是原始例外文字，根本不含那個哨兵字串，於是匯入失敗時迴圈
// 永遠不會結束——遮罩掛著、每 2 秒問一次、沒有停止按鈕，只能重新整理。
//
// 這裡改成把終局錯誤**標記**起來，判斷不再經過人看的字串。

/** 帶著「這是終局錯誤」旗標的 Error。 */
export type FatalJobError = Error & { fatal: true }

/** 建立一個終局錯誤：輪詢迴圈看到就立刻往外拋，不再重試。 */
export function fatalJobError(message: string): FatalJobError {
  return Object.assign(new Error(message), { fatal: true as const })
}

/** 這個錯誤是不是終局的。非 Error 物件（字串、null）一律當成暫時性。 */
export function isFatalJobError(error: unknown): boolean {
  return Boolean(error)
    && typeof error === 'object'
    && (error as { fatal?: unknown }).fatal === true
}

/** 把後端回報的失敗狀態組成一句話。
 *
 *  `message` 是給人看的階段說明（「裁切失敗」），`error` 是原始例外文字。
 *  兩個都可能是空的——後端的失敗路徑並不一致——所以要有最後的預設值。
 */
export function describeJobFailure(
  state: { message?: unknown; error?: unknown },
  fallback: string,
): string {
  const message = String(state?.message || '') || fallback
  const detail = String(state?.error || '')
  return detail ? `${message}\n${detail}` : message
}
