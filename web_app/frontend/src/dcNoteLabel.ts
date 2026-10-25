// 排程表「0 Hz」備註的短標籤。
//
// 後端的 dc_note 是完整的出處說明（「0 Hz：外插（非直接 DC）；本 session 尚無
// 受管原生 DC 成功證據；使用 HFSS 外插」），寫進 provenance 與報告用的。放進
// 排程表的窄欄會換成三行、把整列撐高，而且「受管原生 DC 成功證據」是開發者
// 用語。畫面上只放方法本身；判斷依據 dc_policy.method，舊狀態沒有 dc_policy
// 時才從備註文字推。

import { zhTW } from './i18n/zh-TW'
import type { Messages } from './i18n/zh-TW'

type DcJob = { dc_policy?: { method?: string } | null; dc_note?: string; dc_note_en?: string }

function methodOf(job: DcJob): string {
  const method = job.dc_policy?.method
  if (method) return method
  // 後端以分號隔開方法與理由；理由可能提及前次外插或待驗證，不能覆蓋方法。
  const methods = [job.dc_note, job.dc_note_en]
    .filter((note): note is string => Boolean(note))
    .map(note => {
      const label = note.split(/[;；]/, 1)[0]
      if (/待結果驗證|verification pending/.test(label)) return 'pending_direct_dc'
      if (/外插|extrapolated/.test(label)) return 'extrapolated'
      if (/直接 DC|direct DC/.test(label)) return 'direct_dc'
      return 'unknown'
    })
  // 缺少正式 policy 時，互相矛盾的雙語舊資料不作推定。
  return new Set(methods).size === 1 ? methods[0] : 'unknown'
}

export function dcNoteLabel(job: DcJob, t: Messages = zhTW): { label: string; tip: string } | null {
  if (!job.dc_note && !job.dc_note_en && !job.dc_policy) return null
  const m = t.compactLayout
  const method = methodOf(job)
  const label = method === 'extrapolated' ? m.dcExtrapolated
    : method === 'direct_dc' ? m.dcDirect
      : method === 'pending_direct_dc' ? m.dcPending
        : m.dcUnknown
  return { label, tip: m.dcTip(label) }
}
