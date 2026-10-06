// 分隔線位置的記憶：拖過一次就當成預設，下次開啟維持原樣。
//
//
// 為什麼存「比例」而不是「像素」：這個工具常在不同機器、不同解析度的螢幕上開
// （自己的筆電、會議室投影、求解機的遠端桌面）。存像素的話，在窄螢幕上會讓某
// 一側幾乎消失，在寬螢幕上又只佔一小條。存比例則在任何寬度下都維持同樣的版面
// 感覺。

/** 左側工作列的預設佔比。比 400px 的舊值寬——設定項目一多就得橫向擠壓，
 *  而 Layout 少掉的那點寬度可以用滾輪縮放補回來。 */
const DEFAULT_MAIN: number[] = [36, 64]
/** 預覽與系統日誌的預設佔比。 */
const DEFAULT_LOG: number[] = [78, 22]

const MAIN_KEY = 'pcbsi.split.main.v1'
const LOG_KEY = 'pcbsi.split.log.v1'

function load(key: string, fallback: number[]): number[] {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    // 壞掉的值會讓版面整個塌掉，寧可退回預設。
    if (!Array.isArray(parsed) || parsed.length !== fallback.length) return fallback
    if (!parsed.every(n => typeof n === 'number' && isFinite(n) && n > 0)) return fallback
    return parsed
  } catch {
    return fallback
  }
}

function save(key: string, sizes: number[]): void {
  const total = sizes.reduce((sum, n) => sum + n, 0)
  // 面板收合或還沒量到寬度時 onChange 也會觸發，那時的值不能拿來當偏好。
  if (total <= 0 || sizes.some(n => !isFinite(n) || n <= 0)) return
  try {
    window.localStorage.setItem(
      key, JSON.stringify(sizes.map(n => (n / total) * 100)))
  } catch {
    // localStorage 不可用（無痕模式、配額滿）時不該讓介面壞掉，
    // 只是這次的拖曳不會被記住。
  }
}

export const loadMainSplit = () => load(MAIN_KEY, DEFAULT_MAIN)
export const saveMainSplit = (sizes: number[]) => save(MAIN_KEY, sizes)
export const loadLogSplit = () => load(LOG_KEY, DEFAULT_LOG)
export const saveLogSplit = (sizes: number[]) => save(LOG_KEY, sizes)

// ── 報告工作區 ───────────────────────────────────────────────────────────
//
// 報告快照全部寫進同一個工作區，這個位置必須跨越「換一個匯入來源」而不變。
// 原本它每次都由目前載入的檔案重新推導，於是同一個案子會長出好幾個
// report_workspace（載入板子一個、看串接 .sNp 又一個），快照散落各處。
//
// 這裡只負責記住使用者實際用過的那一個；第一次還沒有時回空字串，由呼叫端
// 依目前檔案推導出預設值。

const REPORT_WORKSPACE_KEY = 'pcbsi.reportWorkspace.v1'
const REPORT_WORKSPACE_INSTANCE_KEY = 'pcbsi.reportWorkspace.instance'

export function loadReportWorkspace(): string {
  try {
    return window.localStorage.getItem(REPORT_WORKSPACE_KEY) || ''
  } catch {
    return ''
  }
}

/** 後端換了一次啟動（instance id 不同）就忘掉記住的工作區，回傳 true。
 *
 *  「跨越換匯入來源而不變」只該在同一次啟動內成立。跨啟動也記的話，
 *  新解壓的工具一開就指回上一個案子的 report_workspace，舊快照全部
 *  跑出來——使用者以為新包帶著舊照。 */
export function resetReportWorkspaceIfNewInstance(instanceId: string): boolean {
  if (!instanceId) return false
  try {
    const previous = window.localStorage.getItem(REPORT_WORKSPACE_INSTANCE_KEY) || ''
    if (previous === instanceId) return false
    window.localStorage.setItem(REPORT_WORKSPACE_INSTANCE_KEY, instanceId)
    const hadWorkspace = !!window.localStorage.getItem(REPORT_WORKSPACE_KEY)
    window.localStorage.removeItem(REPORT_WORKSPACE_KEY)
    return hadWorkspace
  } catch {
    return false
  }
}

export function saveReportWorkspace(path: string): void {
  try {
    if (path) window.localStorage.setItem(REPORT_WORKSPACE_KEY, path)
    else window.localStorage.removeItem(REPORT_WORKSPACE_KEY)
  } catch {
    // localStorage 不可用時不該讓介面壞掉，只是這次的位置不會被記住。
  }
}
