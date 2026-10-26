import type { DisplayLengthUnit } from './lengthUnits'
// 一鍵 HTML 報告共用型別。
import type { Messages } from './i18n/zh-TW'

export type SnapshotStatus = 'pass' | 'attention' | 'fail' | 'display'
export type ReportLocale = 'zh-TW' | 'en' | 'bilingual'
export type ReportSecurityMode = 'external' | 'internal'
export type ReportQuality = 'compact' | 'standard' | 'high'

export interface ReportSnapshot {
  length_unit?: DisplayLengthUnit
  id: string
  kind: string
  title: string
  version: number
  file: string
  media_type: string
  created_at: string
  caption: string
  engineering_status: SnapshotStatus
  section: string
  source_revision: string
  source_metadata: Record<string, unknown>
  stale: boolean
  stale_reason: string
  selected: boolean
  active: boolean
  external: boolean
  sha256: string
  /** 拍攝時的介面語言（舊快照沒有）。 */
  ui_locale?: string | null
}

export interface ReportBrand {
  company_name: string
  department: string
  project_name: string
  customer_name: string
  report_number: string
  logo_file: string
}

export interface WatermarkSettings {
  enabled: boolean
  mode: 'text' | 'image' | 'both'
  scope: 'all' | 'images' | 'custom'
  text: string
  image_file?: string
  image_data_url?: string
  opacity: number
  angle: number
  size: 'small' | 'medium' | 'large' | 'custom'
  layout: 'tile' | 'center'
  color: string
  sections: string[]
  confidentiality?: string
  /** 套用的浮水印範本 id：刪掉那個範本時才知道它正在用。 */
  template_id?: string
}

export interface ReportSettings {
  length_unit?: DisplayLengthUnit
  locale: ReportLocale
  security_mode: ReportSecurityMode
  quality: ReportQuality
  sections: string[]
  purpose: string
  summary: string
  conclusion: string
  recommendations: string
  acceptance_criteria: Record<string, string | number>
  watermark: WatermarkSettings
}

export interface ReportManifest {
  collection?: import('./reportCollect').CollectionOutcome | null
  schema_version: number
  project_name: string
  created_at: string
  updated_at: string
  brand: ReportBrand
  settings: ReportSettings
  snapshots: ReportSnapshot[]
  exports: {
    path: string
    created_at: string
    sha256: string
    snapshot_ids: string[]
    security_mode: ReportSecurityMode
    locale: ReportLocale
  }[]
}

export interface ReportWorkspaceResponse {
  ok: boolean
  workspace: string
  manifest: ReportManifest
  brand_profile: Partial<ReportBrand> & { logo_data_url?: string }
}

type SectionLabel = (t: Messages) => string

/** 章節鍵 → 顯示名稱（：名稱在語言檔 `report.sections`）。
 *  這裡的順序就是勾選清單的順序，要和後端 reporting.DEFAULT_SECTION_ORDER 逐項相同。 */
export const REPORT_SECTION_LABELS: Record<string, SectionLabel> = {
  board: t => t.report.sections.board,
  cutout: t => t.report.sections.cutout,
  cleanup: t => t.report.sections.cleanup,
  segments: t => t.report.sections.segments,
  solver: t => t.report.sections.solver,
  schematic: t => t.report.sections.schematic,
  sparam: t => t.report.sections.sparam,
  models: t => t.report.sections.models,
  eye: t => t.report.sections.eye,
  tdr: t => t.report.sections.tdr,
  crosssection: t => t.report.sections.crosssection,
  results: t => t.report.sections.results,
  external: t => t.report.sections.external,
}

/** 章節的顯示名稱；認不得的鍵（之後新增、外部匯入）顯示鍵本身。 */
export function reportSectionLabel(t: Messages, section: string): string {
  return REPORT_SECTION_LABELS[section]?.(t) ?? section
}

export const REPORT_SECTION_ORDER = Object.keys(REPORT_SECTION_LABELS)

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  mode: 'text',
  scope: 'all',
  // 出廠預設字：後端認得這兩個中文值，產生時依報告語言換成 Confidential。
  // 前端若改成英文，中文報告就會印英文——所以不翻，畫面上另有說明。
  text: '機密文件',
  opacity: 0.28,
  angle: -30,
  size: 'medium',
  layout: 'tile',
  color: '#4b5563',
  sections: [],
  confidentiality: '機密',
}

export const DEFAULT_REPORT_SETTINGS: ReportSettings = {
  locale: 'zh-TW',
  security_mode: 'external',
  quality: 'standard',
  sections: REPORT_SECTION_ORDER,
  purpose: '',
  summary: '',
  conclusion: '',
  recommendations: '',
  acceptance_criteria: {},
  watermark: DEFAULT_WATERMARK,
}
