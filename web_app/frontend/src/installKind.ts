// 這份工具是安裝版還是原始碼版（ 驗收發現 K）。
//
// 安裝版沒有使用者可以點的 start.bat，叫人「重新執行 start.bat」等於叫他找一個
// 不存在的檔案。後端 /api/version 回 install_kind（版面判斷，見 backend/app/install_kind.py），
// 這裡記住它；後端已經連不上時也還說得出正確的指示，所以另存一份到 localStorage。
// 從來沒問到過就是 unknown，兩種說法都講。
import { messagesFor } from './i18n/catalog'
import type { Lang } from './i18n/lang'

export type InstallKind = 'installed' | 'source' | 'unknown'

export const INSTALL_KIND_STORAGE_KEY = 'pcbsi.installKind'

let current: InstallKind | null = null

function normalize(value: unknown): InstallKind {
  return value === 'installed' || value === 'source' ? value : 'unknown'
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** 記下後端回報的型態（/api/version 的 install_kind）；看不懂的值不覆蓋已知的。 */
export function rememberInstallKind(value: unknown): void {
  const kind = normalize(value)
  if (kind === 'unknown') return
  current = kind
  try { storage()?.setItem(INSTALL_KIND_STORAGE_KEY, kind) } catch { /* 存不了只影響下次離線時的說法 */ }
}

export function currentInstallKind(): InstallKind {
  if (current) return current
  let stored: string | null = null
  try { stored = storage()?.getItem(INSTALL_KIND_STORAGE_KEY) ?? null } catch { stored = null }
  return normalize(stored)
}

/** 「關掉工具後怎麼重新啟動」的片語，例如「重新開啟 PCB SI」。 */
export function restartHint(lang: Lang, kind: InstallKind = currentInstallKind()): string {
  return messagesFor(lang).restartHint[kind]
}

/** 測試用：清掉記憶體裡的值。 */
export function resetInstallKindForTest(): void {
  current = null
}
