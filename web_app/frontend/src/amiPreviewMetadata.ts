// 秒級預覽（SPISimAMI 統計眼）寫進報告快照 source_metadata 的內容。
// 眼圖精靈第 4 步「進階」使用（#0104 從舊 AMI 面板抽出，ADR-0067 後只剩精靈）。鍵是中文：後端與既有工作區紀錄相依，
// 改鍵另案處理（tests/test_i18n_source_scan.py 的 ALLOWED）。

type AnyRecord = Record<string, any>

export function previewReportMetadata(
  data: AnyRecord, touchstone: string,
  modelFile: (model: string, file: string) => string, note: string,
): Record<string, string> | null {
  const metrics = data?.quick_eye?.metrics
  if (!metrics) return null
  return {
    '統計眼_眼高(V)': Number(metrics.eye_height_v ?? 0).toFixed(3),
    '統計眼_眼寬(UI)': Number(metrics.eye_width_ui ?? 0).toFixed(2),
    '統計眼_調變': data.quick_eye.modulation || 'NRZ',
    '統計眼_Tx': modelFile(data.model, data.ami_file),
    '統計眼_Rx': data.rx ? modelFile(data.rx.model, data.rx.ami_file) : '—',
    '統計眼_通道': touchstone.split(/[\\/]/).pop() || touchstone,
    '統計眼_說明': note,
  }
}
