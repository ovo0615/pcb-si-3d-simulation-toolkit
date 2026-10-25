// licensed 包的報告身分浮水印（／S02）。
// 後端 `license_watermark.py` 一律加上固定樣式的身分標示，使用者浮水印設定在
// licensed 模式不採用；報告中心據此顯示實際會套用的標示、停用會被忽略的控制。

export type ProductLicenseStatus = {
  mode?: string
  valid?: boolean
  watermark?: string
} | null | undefined

export type LicenseWatermark = { active: boolean; text: string }

/** 與後端 LICENSE_WATERMARK_STYLE 的 HTML 疊層值一致（測試會比對）。 */
export const LICENSE_WATERMARK_PREVIEW = {
  stripeOpacity: 0.05,
  stripeFontPx: 14,
  stripeAngle: -30,
}

/** source 模式不加身分；licensed（含到期、未驗證）一律加，到期時文字由後端決定。 */
export function licenseWatermarkFrom(status: ProductLicenseStatus): LicenseWatermark {
  if (!status || status.mode !== 'licensed') return { active: false, text: '' }
  return { active: true, text: status.valid ? String(status.watermark || '') : '' }
}

/** 查不到授權狀態時回 null：畫面維持原樣，後端產報告時仍會強制加上身分標示。 */
export async function fetchLicenseWatermark(): Promise<LicenseWatermark | null> {
  try {
    const response = await fetch('/api/product-license/status')
    return response.ok ? licenseWatermarkFrom(await response.json()) : null
  } catch {
    return null
  }
}
