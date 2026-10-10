// 模型健檢紀錄 → 畫面上那一行字（卡 0085）。
//
// 後端從 #0085 起多一種狀態 `invalid_result`：模型跑完了，但 AMI 結果判無效
// （通道時域響應發散）。原本這裡只認 passed／not_applicable／license_unavailable，
// 其餘一律紅字「失敗」，配上「健檢不過＝模型問題」的提示，等於把參考通道的問題
// 算到模型頭上。抽成純函式，才能不靠 DOM 直接測。

export type HealthRecord = {
  status: string
  seconds?: number
  at?: string
  reason?: string
}

export type HealthTone = 'pass' | 'info' | 'warn' | 'fail'

export type HealthView = {
  tone: HealthTone
  text: string
  /** 滑鼠提示：完整原因。畫面上只放前 80 字。 */
  title?: string
}

const DETAIL_CHARS = 80
/** 後端 `run_healthcheck` 寫在原因開頭的歸因；畫面上自己講，不重複印。 */
const INVALID_PREFIX = /^結果無效（[^）]*）：?/

export function healthStatusView(record: HealthRecord): HealthView {
  const reason = record.reason || ''
  switch (record.status) {
    case 'passed':
      return { tone: 'pass', text: `通過（${record.seconds} 秒，${record.at}）` }
    case 'not_applicable':
      return { tone: 'info', text: reason }
    case 'license_unavailable':
      // 授權不足：健檢沒跑完，不代表模型有問題。
      return { tone: 'warn', text: `沒跑完：${reason.slice(0, DETAIL_CHARS)}`, title: reason }
    case 'invalid_result': {
      const detail = reason.replace(INVALID_PREFIX, '')
      const more = detail.length > DETAIL_CHARS ? '…' : ''
      return {
        tone: 'warn',
        text: `結果無效，不是模型問題（參考通道的時域響應不可用）：${detail.slice(0, DETAIL_CHARS)}${more}`,
        title: reason,
      }
    }
    default:
      return { tone: 'fail', text: `失敗：${reason.slice(0, DETAIL_CHARS)}`, title: reason }
  }
}
