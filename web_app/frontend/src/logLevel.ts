// 系統日誌的顏色分級。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 原本是一條 `/錯誤|失敗|error|fail/i` 直接掃整行，誤判很多：
//
//   * 「Sweep Error Tolerance 已設為 5%」——AEDT 的欄位名裡有 Error，被塗紅。
//   * 「完成：成功 32 段、失敗 0 段」——在報數字，沒有任何東西失敗。
//   * 「[分段] 警告：刪除 Port 失敗」——已經標明是警告，卻蓋成錯誤。
//   * 「板框提取失敗，已成功動態推算範圍」——講的是已經處理掉的回退。
//
// 紅字的意義是「這裡出事了，要看」。如果正常流程也一片紅，紅字就沒有意義了，
// 真正的錯誤反而會被忽略——這比不上色還糟。
//
// 規則刻意只認中文關鍵字：後端所有訊息都是中文，英文字只會出現在 AEDT 的欄位
// 名、檔名與例外訊息裡，拿它們判斷嚴重性只會製造誤判。

export type LogLevel = 'error' | 'warn' | 'info'

/** 已標明是警告的行。警告優先於錯誤——寫的人已經表態了，不要再猜。 */
const WARN = /警告|注意/

/** 「失敗，但已經處理掉了」。這類回退是設計的一部分，不是出事。 */
const RECOVERED = /失敗[^。]{0,40}?(改用|改由|已改|回退|退回|沿用|已成功|仍可|不影響)/

/** 「失敗 0 段」「失敗 0、」這種計數，數字是 0 就沒有東西失敗。
 *  後端的摘要行已改成零就不列，這條是防守——漏掉一處也不會整行變紅。 */
const ZERO_FAILURES = /失敗\s*0(\s*(段|個|筆|條|層|項))?(?!\d)/

const ERROR = /錯誤|失敗|例外/

export function logLevel(line: string): LogLevel {
  if (WARN.test(line)) return 'warn'
  if (RECOVERED.test(line)) return 'warn'
  if (ZERO_FAILURES.test(line)) return 'info'
  if (ERROR.test(line)) return 'error'
  return 'info'
}

/** 對應到 CSS 變數；info 回 undefined，沿用容器本身的顏色。 */
export function logColor(line: string): string | undefined {
  const level = logLevel(line)
  if (level === 'error') return 'var(--danger)'
  if (level === 'warn') return 'var(--warn)'
  return undefined
}
