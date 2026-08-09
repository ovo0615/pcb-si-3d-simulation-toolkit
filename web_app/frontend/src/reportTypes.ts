// 一鍵 HTML 報告共用型別。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

export type SnapshotStatus = 'pass' | 'attention' | 'fail' | 'display'
export type ReportLocale = 'zh-TW' | 'en' | 'bilingual'
export type ReportSecurityMode = 'external' | 'internal'
export type ReportQuality = 'compact' | 'standard' | 'high'

export interface ReportSnapshot {
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
}

export interface ReportSettings {
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

export const REPORT_SECTION_LABELS: Record<string, string> = {
  board: '原始電路板與目標通道',
  cutout: '裁切後 Layout',
  cleanup: 'Layout 清理比較',
  segments: 'N 段分割',
  solver: '求解狀態與設定',
  schematic: '電路串接',
  sparam: 'S 參數結果',
  eye: '眼圖結果',
  results: '模擬結果',
  external: '補充證據',
}

export const REPORT_SECTION_ORDER = Object.keys(REPORT_SECTION_LABELS)

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  mode: 'text',
  scope: 'all',
  text: '機密文件',
  opacity: 0.12,
  angle: -30,
  size: 'medium',
  layout: 'tile',
  color: '#6b7280',
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
