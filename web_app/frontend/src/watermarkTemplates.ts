// 報告浮水印範本的規則。範本存在後端；這裡只放不需要 React 的判斷。
//
// 舊版把範本存在 localStorage（LEGACY_TEMPLATE_KEY），畫面只有下拉選單、
// 不能刪、看不出建立時間；localStorage 又綁 origin，換埠號就「不見」。
// 開報告中心時把那份搬到後端，搬完改名保留（不直接刪）。
import type { WatermarkSettings } from './reportTypes'

export const LEGACY_TEMPLATE_KEY = 'pcbsi.report.watermarkTemplates.v1'
export const LEGACY_MIGRATED_KEY = `${LEGACY_TEMPLATE_KEY}.migrated`

export interface WatermarkTemplate {
  id: string
  name: string
  name_en?: string
  builtin: boolean
  created_at: string
  updated_at: string
  /** `browser`＝從舊版 localStorage 搬過來；建立時間是搬過來的時間。 */
  imported_from?: string
  settings: Partial<WatermarkSettings>
  image_data_url: string
}

type LegacyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** localStorage 裡的舊範本；不是陣列就當沒有。 */
export function legacyTemplatesFrom(raw: string | null | undefined): unknown[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 搬到後端之後：原 key 改名保留，下次不再搬，萬一要救也還在。 */
export function markLegacyMigrated(storage: LegacyStorage): void {
  const raw = storage.getItem(LEGACY_TEMPLATE_KEY)
  if (raw == null) return
  storage.setItem(LEGACY_MIGRATED_KEY, raw)
  storage.removeItem(LEGACY_TEMPLATE_KEY)
}

export function templateLabel(template: WatermarkTemplate, lang: string): string {
  return (lang === 'en' && template.name_en) || template.name
}

/** `2026-10-12T14:44:05` → `2026-10-12 14:44`。 */
export function templateTime(iso: string | undefined): string {
  return (iso || '').replace('T', ' ').slice(0, 16)
}

export function isDeletable(template: WatermarkTemplate): boolean {
  return !template.builtin
}

/** 另存範本用的名字已經是某個自訂範本：要先問，存下去會蓋掉它。 */
export function overwritesTemplate(templates: WatermarkTemplate[], name: string): boolean {
  return templates.some(item => !item.builtin && item.name === name)
}

/** 套用範本：「啟用」維持目前的勾選（避免一套用就印上客戶資料），並記下範本 id，
 *  之後刪掉這個範本時才知道它正在用。目前工作區的圖（image_file）一併拿掉：
 *  範本有圖時由呼叫端另外帶入，沒有圖就不該殘留上一張。 */
export function watermarkFromTemplate<T extends Partial<WatermarkSettings>>(
  current: T, template: WatermarkTemplate,
): T & { template_id: string } {
  const next = { ...current, ...template.settings, enabled: current.enabled, template_id: template.id }
  delete next.image_file
  return next as T & { template_id: string }
}

/** 比對「使用中」看的欄位：啟用與否不算修改。 */
const COMPARED: (keyof WatermarkSettings)[] = [
  'mode', 'scope', 'text', 'opacity', 'angle', 'size', 'layout', 'color', 'confidentiality',
]

/** 套用了這個範本、而且之後沒有手動改過。改過就是使用者自己的設定，
 *  刪範本時不能把它洗回預設。 */
export function isTemplateInUse(watermark: Partial<WatermarkSettings>, template: WatermarkTemplate, imageDataUrl = ''): boolean {
  if (!watermark.template_id || watermark.template_id !== template.id) return false
  if (JSON.stringify(watermark.sections || []) !== JSON.stringify(template.settings.sections || [])) return false
  const pendingImage = imageDataUrl || watermark.image_data_url || ''
  if (pendingImage && pendingImage !== (template.image_data_url || '')) return false
  if (watermark.image_file && !template.image_data_url) return false
  return COMPARED.every(key => template.settings[key] === undefined || watermark[key] === template.settings[key])
}

/** 刪除範本後要不要把目前的浮水印回到預設：只有刪的是正在用的那個才要。 */
export function deleteOutcome(template: WatermarkTemplate, watermark: Partial<WatermarkSettings>, imageDataUrl = '') {
  const allowed = isDeletable(template)
  return { allowed, resetToDefault: allowed && isTemplateInUse(watermark, template, imageDataUrl) }
}
