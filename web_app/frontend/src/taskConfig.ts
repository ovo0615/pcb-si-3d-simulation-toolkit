// 入口介面：使用者勾選這次要用的模擬項目，介面只顯示勾選的部分。
//
//
// 設計要點：
//  * 勾選單位是「任務」而不是「面板」——使用者想的是「我要切局部」，不是
//    「我要看裁切設定面板」。
//  * 任務與面板**不是一對一**：「模擬設定」面板被設定 Port 與求解器、
//    N 段分割、排程求解共用，任一個勾了就得顯示。
//  * 遠端求解包不是獨立面板，而是排程面板裡的區塊。
//  * 舊版的 `eye` 鍵只保留做 localStorage 遷移；眼圖設定已整合進右側 IBIS 分析頁。
//
// ：這裡只留結構（鍵、前置、父子），名稱、預估耗時與說明在語言檔
// `tasks` 區塊，由 `taskGroups(t.tasks)` 組成畫面用的清單。

import type { Messages } from './i18n/zh-TW'

export type TaskKey =
  | 'load'
  | 'cutout'
  | 'ports'
  | 'stackup'
  | 'backdrill'
  | 'cleanup'
  | 'segment'
  | 'schedule'
  | 'remotepack'
  | 'cascade'
  | 'sparam'
  | 'eye'
  | 'models'
  | 'tdr'
  | 'crosssection'
  | 'report'

/** 畫面上看得到的任務（`eye` 只留給 localStorage 遷移，不在入口出現）。 */
export type VisibleTaskKey = Exclude<TaskKey, 'eye'>

export interface TaskDef {
  key: VisibleTaskKey
  label: string
  hint: string
  /**
   * 預估耗時，顯示在項目名稱右邊（例如「約 2 分」）。
   *
   * 靜態估計值，不是即時預測——機器、板子大小與求解器設定會讓實際時間差好幾倍
   * （光是裁切，小板幾分鐘、大板半小時都有）。放在這裡只是讓使用者在勾選前
   * 對量級有概念，數字要調隨時可以改。取自 HANDOFF.md 記過的實測：
   * 載入整趟 45 秒、大型板裁切 20~30 分、截面阻抗一條 20~40 秒、
   * 基準眼圖約 40 秒；求解那項變化最大，三段 SIwave 各 22 秒，
   * HFSS 大案子則有跑到 6.5 小時的紀錄。
   */
  eta?: string
  /** 前置任務。只用於提示，不會自動代勾、也不會阻擋。 */
  requires?: TaskKey[]
  /** 前置不足時要補充說明的例外情形。 */
  requiresNote?: string
  /** 取消勾選這個項目時要一併說明的後果，顯示在項目底下。 */
  offNote?: string
  /**
   * 子選項：只有在父項目勾選時才顯示。
   *
   * 「載入電路板」底下的兩個項目全都 requires: ['load']，攤平成同層會讓人以為
   * 三者平行；實際上不載入板子就只剩外部 S 參數串接可用。做成父子關係，畫面
   * 才對得上真正的相依。
   */
  children?: TaskDef[]
}

export interface TaskGroup {
  title: string
  tasks: TaskDef[]
}

/** 任務的結構：沒有任何畫面文字。 */
interface TaskNode {
  key: VisibleTaskKey
  requires?: TaskKey[]
  children?: TaskNode[]
}

type GroupId = keyof Messages['tasks']['groups']

const TASK_TREE: { id: GroupId; tasks: TaskNode[] }[] = [
  {
    id: 'prepare',
    tasks: [
      {
        key: 'load',
        children: [
          { key: 'cutout', requires: ['load'] },
          // 排在裁切之後（快很多），但要在背鑽與設定 Port 之前。
          { key: 'stackup', requires: ['load'] },
        ],
      },
    ],
  },
  {
    id: 'preprocess',
    tasks: [
      { key: 'backdrill', requires: ['load'] },
      { key: 'cleanup', requires: ['load'] },
    ],
  },
  {
    id: 'analysis',
    tasks: [
      { key: 'ports', requires: ['load'] },
      { key: 'segment', requires: ['load'] },
      { key: 'schedule', requires: ['segment'] },
      { key: 'remotepack', requires: ['schedule'] },
    ],
  },
  {
    id: 'results',
    tasks: [
      { key: 'cascade', requires: ['segment'] },
      { key: 'sparam', requires: ['cascade'] },
      { key: 'models' },
      { key: 'tdr', requires: ['cascade'] },
      // 只需要板子，不需要求解結果——它算的是幾何。
      { key: 'crosssection', requires: ['load'] },
      { key: 'report' },
    ],
  },
]

/** 畫面用的清單：結構加上目前語言的名稱與說明。 */
export function taskGroups(t: Messages['tasks']): TaskGroup[] {
  const build = (node: TaskNode): TaskDef => ({
    ...t.items[node.key],
    key: node.key,
    requires: node.requires,
    children: node.children?.map(build),
  })
  return TASK_TREE.map(group => ({ title: t.groups[group.id], tasks: group.tasks.map(build) }))
}

function flatten<T extends { children?: T[] }>(tasks: T[]): T[] {
  return tasks.flatMap(task => [task, ...flatten(task.children ?? [])])
}

/** 所有看得到的任務（攤平、沒有文字）：判斷鍵與前置用。 */
const ALL_NODES: TaskNode[] = flatten(TASK_TREE.flatMap(group => group.tasks))

/** 攤平後的任務清單（含目前語言的文字）。 */
export function allTasks(t: Messages['tasks']): TaskDef[] {
  return flatten(taskGroups(t).flatMap(group => group.tasks))
}

/** 首次啟動的預設組：能一路走完的最短路徑。
 *
 *  刻意不含選用的前處理與進階檢視——新使用者第一次打開若看到全部項目，就等於
 *  沒有解決「功能太多」這件事。日後新增功能**一律不進這組**，由使用者自己開，
 *  否則預設組會隨版本越長越大而失去意義。
 */
export const DEFAULT_TASKS: TaskKey[] = [
  // 'ports' 必須在預設組裡：沒有元件端 Port，排程求解與電路串接都做不了。
  // 當初把裁切與 Port 拆成兩個項目時漏掉了它，等於預設走完流程也拿不到結果。
  'load', 'cutout', 'ports', 'segment', 'schedule', 'cascade', 'sparam',
]

/** 入口畫面的「全選」：所有看得到的任務。 */
export const ALL_TASK_SELECTION: TaskKey[] = ALL_NODES.map(node => node.key)

export type TaskFlags = Record<TaskKey, boolean>

/** 型別上存在的每一個任務鍵。
 *
 *  `TASK_GROUPS` 少了 `eye`（那個鍵只留給 localStorage 遷移），於是
 *  `makeFlags` 產出的旗標裡沒有 `eye` 這個屬性——但型別是
 *  `Record<TaskKey, boolean>`，TypeScript 不會抱怨，讀到的是 `undefined`，
 *  而 `!undefined` 恆真。實際後果：`!show.eye && eyeJob?.running` 讓眼圖一跑
 *  就顯示「項目已隱藏」。旗標一律先補成 false，讓型別說的是實話。 */
const ALL_TASK_KEYS: TaskKey[] = [
  'load', 'cutout', 'ports', 'stackup', 'backdrill', 'cleanup',
  'segment', 'schedule', 'remotepack', 'cascade', 'sparam',
  'eye', 'models', 'tdr', 'crosssection', 'report',
]

export function makeFlags(keys: Iterable<TaskKey>): TaskFlags {
  const set = new Set(keys)
  const flags = {} as TaskFlags
  for (const key of ALL_TASK_KEYS) flags[key] = false
  for (const node of ALL_NODES) flags[node.key] = set.has(node.key)
  return flags
}

/** 缺少前置任務的項目；只用於提示，不阻擋。 */
export function missingPrerequisites(
  flags: TaskFlags,
  t: Messages['tasks'],
): { task: TaskDef; missing: TaskDef[] }[] {
  const tasks = allTasks(t)
  const byKey = new Map<TaskKey, TaskDef>(tasks.map(task => [task.key, task]))
  const result: { task: TaskDef; missing: TaskDef[] }[] = []
  for (const task of tasks) {
    if (!flags[task.key] || !task.requires) continue
    const missing = task.requires
      .filter(key => !flags[key])
      .map(key => byKey.get(key))
      .filter((item): item is TaskDef => Boolean(item))
    if (missing.length) result.push({ task, missing })
  }
  return result
}

const STORAGE_KEY = 'pcbsi.enabledTasks.v1'

/** 存下來的任務清單（localStorage 或工作階段快照）→ 可用的任務鍵；
 *  不是陣列回 null，讓呼叫端退回下一個來源。 */
export function normalizeTaskList(parsed: unknown): TaskKey[] | null {
  if (!Array.isArray(parsed)) return null
  const valid = new Set<TaskKey>(ALL_TASK_SELECTION)
  // 舊版把眼圖放在左側串接工作列。新版統一搬到右側 IBIS 分析頁，
  // 曾勾選 `eye` 的使用者自動改成啟用 `models`，不要求重設入口選項。
  const migrated = parsed.includes('eye') && !parsed.includes('models')
    ? [...parsed, 'models'] : parsed
  // 過濾掉已不存在的鍵：舊版存下來的項目若被移除，不該讓整份設定失效。
  return migrated.filter((key): key is TaskKey => valid.has(key))
}

export function loadSavedTasks(): TaskKey[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return normalizeTaskList(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveTasks(keys: TaskKey[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  } catch {
    // localStorage 不可用（無痕模式、配額滿）時不該讓介面壞掉，
    // 只是這次的勾選不會被記住。
  }
}
