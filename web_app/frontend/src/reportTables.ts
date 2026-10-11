// 快照附帶的量測表（#0115）。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 報告的資料來源是「更新報告快照」拍下的結果畫面。眼圖參數收進抽屜（掛在 body）
// 後，截圖裡沒有眼高、眼寬這些數字；所以快照時把結果畫面裡標了
// data-report-tables 的區塊的表格文字一起送出，報告印在那張圖下面。
import { sanitizeReportText } from './reportPrivacy'

export interface ReportTableData {
  title: string
  columns: string[]
  rows: string[][]
}

/** 依文件順序走過的一個節點：小標（h4）或一張表。 */
export type ReportTableEntry =
  | { heading: string }
  | { columns: string[]; rows: string[][] }

/** 表的標題接最近的小標；沒有表頭的表補 `fallbackColumns`；空表、空列丟掉；路徑換成檔名。 */
export function buildReportTables(entries: ReportTableEntry[], fallbackColumns: readonly string[]): ReportTableData[] {
  const clean = (text: string) => sanitizeReportText(String(text ?? '').replace(/\s+/g, ' ').trim())
  const tables: ReportTableData[] = []
  let title = ''
  for (const entry of entries) {
    if ('heading' in entry) {
      title = clean(entry.heading)
      continue
    }
    const rows = entry.rows.map(row => row.map(clean)).filter(row => row.some(Boolean))
    if (!rows.length) continue
    const columns = entry.columns.length ? entry.columns.map(clean) : [...fallbackColumns]
    tables.push({ title, columns, rows })
  }
  return tables
}

/** 從快照目標裡標了 data-report-tables 的區塊收表（抽屜關著時那份隱藏副本也算）。 */
export function collectReportTables(root: HTMLElement, fallbackColumns: readonly string[]): ReportTableData[] {
  const entries: ReportTableEntry[] = []
  const text = (node: Element) => node.textContent || ''
  for (const block of Array.from(root.querySelectorAll<HTMLElement>('[data-report-tables="true"]'))) {
    for (const node of Array.from(block.querySelectorAll('h4, table'))) {
      if (node.tagName === 'H4') {
        entries.push({ heading: text(node) })
        continue
      }
      const table = node as HTMLTableElement
      entries.push({
        columns: Array.from(table.querySelectorAll('thead th')).map(text),
        rows: Array.from(table.querySelectorAll('tbody tr')).map(
          row => Array.from(row.querySelectorAll('td, th')).map(text)),
      })
    }
  }
  return buildReportTables(entries, fallbackColumns)
}
