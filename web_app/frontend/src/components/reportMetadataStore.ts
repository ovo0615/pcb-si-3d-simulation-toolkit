// 模型分頁的報告中繼資料（2026-08-29）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 快照是一張圖，圖上的數字縮進報告未必讀得出來；秒測／統計眼／COM 的
// 關鍵數字寫進這個 store，App 的快照按鈕把它掛進 source_metadata，
// 報告裡就以文字表格保留。內容只活在前端記憶體——它描述「畫面上現在
// 這批結果」，重整後畫面沒了、數字也該跟著歸零。

const store: Record<string, unknown> = {}

/** 覆寫同類結果的數字（例如新一輪統計眼蓋掉上一輪）。 */
export function setModelsReportMetadata(patch: Record<string, unknown>): void {
  Object.assign(store, patch)
}

export function modelsReportMetadata(): Record<string, unknown> {
  return { ...store }
}
