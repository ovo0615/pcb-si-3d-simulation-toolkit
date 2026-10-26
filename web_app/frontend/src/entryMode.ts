// 入口勾選與後端分段模式的對齊。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 入口的「局部裁切」決定後端把載入的板子當成整片板（要先裁切）還是通道
// （直接分段）。兩件事要一致：
//  * 重開視窗時，入口勾選要和上次一樣——它跟著工作階段快照走，不能只靠
//    localStorage（綁埠號，後端換埠或 WebView2 資料被清就退回預設組）。
//  * 只有「已知後端目前是什麼模式」而且和入口不同時才去同步；掛載當下、
//    接續載入進行中、後端沒有板子，都不是不一致。
// 本檔不 import React，Node 測試直接跑。

import { DEFAULT_TASKS, normalizeTaskList, type TaskKey } from './taskConfig'

/** 入口勾選的初值：快照 → localStorage → 預設組。 */
export function initialEnabledTasks(snapshotValue: unknown, saved: TaskKey[] | null): TaskKey[] {
  return normalizeTaskList(snapshotValue) ?? saved ?? [...DEFAULT_TASKS]
}

/** 載入完成後後端的分段模式；null＝入口管不到（裁切過的板，就緒由 Port 決定）。
 *  後端有回 segment_ready 就以它為準（接回同一片板時不看請求帶的模式）。 */
export function backendDirectAfterLoad(
  data: { segment_ready?: unknown; is_cut?: unknown } | null | undefined,
  requested: boolean,
): boolean | null {
  if (data?.is_cut === true) return null
  return typeof data?.segment_ready === 'boolean' ? data.segment_ready : requested
}

export interface EntrySyncState {
  /** 入口目前要求的模式（沒勾局部裁切＝true）。 */
  entryDirect: boolean
  /** 後端目前的模式；null＝未知或不適用（還沒載入、裁切過）。 */
  backendDirect: boolean | null
  isLoading: boolean
}

export function entryModeSyncNeeded(state: EntrySyncState): boolean {
  if (state.isLoading || state.backendDirect === null) return false
  return state.backendDirect !== state.entryDirect
}

/** 後端回「EDB 尚未載入」：沒有板子就沒有東西要對齊，下一次載入會帶入口模式。 */
export function isNoBoardError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'edb.not_loaded'
}

export interface EntryModeSyncer {
  /** 入口模式改變、或載入中旗標改變時呼叫：需要就送同步，不需要就什麼都不做。 */
  request(entryDirect: boolean, isLoading: boolean): void
  /** 載入／重新載入原始檔完成（或失敗）後記下後端模式；在路上的同步回應作廢。 */
  setBackend(direct: boolean | null): void
  backend(): boolean | null
}

/** 入口勾選 → 後端分段模式的同步器。
 *
 *  同一時間只送一個 /api/segment_mode；回應回來後拿「最新的入口勾選」再比一次。
 *  不這樣做的話，第一個同步還在路上時把勾選切回來，後端模式仍是舊值、判定一致
 *  而略過；接著第一個回應把後端改成另一個模式，前後端就一直不同步。
 *  同步失敗只報一次、不自動重送；下一次使用者改勾選或載入結束才再試。 */
export function createEntryModeSyncer(opts: {
  send: (direct: boolean) => Promise<unknown>
  onError: (error: unknown, direct: boolean) => void
}): EntryModeSyncer {
  let backend: boolean | null = null
  let wanted: boolean | null = null
  let loading = false
  let inFlight = false
  let failed = false
  // 載入會換掉後端狀態：之前送出的同步回應一律作廢。
  let generation = 0

  const pump = () => {
    if (inFlight || failed || wanted === null) return
    if (!entryModeSyncNeeded({ entryDirect: wanted, backendDirect: backend, isLoading: loading })) return
    const target = wanted
    const gen = generation
    inFlight = true
    opts.send(target)
      .then(result => {
        if (gen === generation) backend = backendDirectAfterLoad(result as never, target)
      })
      .catch(e => {
        if (gen !== generation) return
        // 後端沒有板子：沒有東西要對齊，下一次載入會帶入口模式過去。
        if (isNoBoardError(e)) { backend = null; return }
        failed = true
        opts.onError(e, target)
      })
      .finally(() => { inFlight = false; pump() })
  }

  return {
    request(entryDirect, isLoading) {
      wanted = entryDirect
      loading = isLoading
      failed = false
      pump()
    },
    setBackend(direct) {
      generation += 1
      backend = direct
    },
    backend: () => backend,
  }
}
