// useState 的工作階段版：值會跟著關窗保存、下次開窗原樣讀回。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 只給「使用者的設定與畫面」用（路徑、網路、分段、求解設定、目前頁面⋯）。
// 結果與幾何不要用這個：那些很大，而且應該從檔案重建。
import { useEffect, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { compatible, notifySessionChange, registerSessionField, restoredFieldValue } from './uiSession'

interface PersistentPreference<T> {
  key: string
  valid: (value: T) => boolean
}

/** key 給空字串＝不保存，等同 useState（同一個元件有多份、只有其中一份要保存時用）。 */
export function useSessionState<T>(key: string, initial: T | (() => T),
  preference?: PersistentPreference<T>): [T, Dispatch<SetStateAction<T>>] {
  const sample = useRef<T | null>(null)
  const [value, setValue] = useState<T>(() => {
    const fallback = typeof initial === 'function' ? (initial as () => T)() : initial
    sample.current = fallback
    if (preference) {
      try {
        const raw = window.localStorage.getItem(preference.key)
        const saved = raw === null ? undefined : JSON.parse(raw)
        if (compatible(fallback, saved) && preference.valid(saved)) return saved as T
      } catch { /* 偏好不可讀時仍允許設定，舊快照只作首次遷移。 */ }
    }
    return key ? restoredFieldValue(key, fallback) : fallback
  })
  const current = useRef(value)
  current.current = value
  const preferenceKey = preference?.key
  const preferenceValid = preference?.valid
  useEffect(() => key && !preferenceKey ? registerSessionField(key, () => current.current,
    next => setValue(next as T), sample.current) : undefined, [key, preferenceKey])
  useEffect(() => {
    if (!preferenceKey || !preferenceValid?.(value)) return
    try { window.localStorage.setItem(preferenceKey, JSON.stringify(value)) }
    catch { /* 快取不可寫時保留本輪設定。 */ }
  }, [value, preferenceKey, preferenceValid])
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (key && !preferenceKey) notifySessionChange()
  }, [value, key, preferenceKey])
  return [value, setValue]
}

/** useRef 的工作階段版：給「使用者動過沒」這類旗標用（例如 solutionFreqTouched）。
 *  ref 改了不會觸發重繪，所以不會自己觸發自動保存；跟著下一次欄位變更一起存。 */
export function useSessionRef<T>(key: string, initial: T): MutableRefObject<T> {
  const ref = useRef<T>(restoredFieldValue(key, initial))
  useEffect(() => registerSessionField(key, () => ref.current,
    next => { ref.current = next as T }, initial), [key])
  return ref
}
