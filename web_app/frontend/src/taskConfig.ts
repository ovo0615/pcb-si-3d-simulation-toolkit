// 入口介面：使用者勾選這次要用的模擬項目，介面只顯示勾選的部分。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 設計要點：
//  * 勾選單位是「任務」而不是「面板」——使用者想的是「我要切局部」，不是
//    「我要看裁切設定面板」。
//  * 任務與面板**不是一對一**：「模擬設定」面板被設定 Port 與求解器、
//    N 段分割、排程求解共用，任一個勾了就得顯示。
//  * 有三個任務不是獨立面板，而是別的面板裡的區塊（遠端求解包在排程面板內、
//    分段對照與眼圖在串接面板內）。

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
  | 'fidelity'
  | 'eye'
  | 'report'

export interface TaskDef {
  key: TaskKey
  label: string
  hint: string
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

export const TASK_GROUPS: TaskGroup[] = [
  {
    title: '準備',
    tasks: [
      {
        key: 'load',
        label: '載入電路板',
        hint: '匯入 .aedb／.brd／.tgz，選擇訊號與參考網路。',
        offNote: '不勾選＝不載入板子，只能用「外部 S 參數檔」做串接與檢視。',
        children: [
          {
            key: 'cutout',
            label: '局部裁切',
            hint: '依訊號範圍裁出通道。只做裁切，不建立 Port。',
            requires: ['load'],
          },
          {
            key: 'ports',
            label: '設定 Port 與求解器',
            hint: '在通道上建立元件端 Port 與 HFSS Setup／掃頻。',
            requires: ['load'],
          },
        ],
      },
    ],
  },
  {
    title: '前處理（選用）',
    tasks: [
      {
        key: 'stackup',
        label: '疊構更換',
        hint: '以外部疊構檔取代現有 Stackup，可比對差異後再套用。',
        requires: ['load'],
      },
      {
        key: 'backdrill',
        label: '背鑽',
        hint: '分析訊號 Via 殘樁並寫入背鑽，含共振頻率預估。',
        requires: ['load'],
      },
      {
        key: 'cleanup',
        label: 'Layout 清理',
        hint: '移除電磁影響範圍外的銅箔與 Via，降低後續求解負擔。',
        requires: ['load'],
      },
    ],
  },
  {
    title: '分段與求解',
    tasks: [
      {
        key: 'segment',
        label: 'N 段分割',
        hint: '沿通道主方向切成 N 段，於切面建立 Port。',
        requires: ['load'],
      },
      {
        key: 'schedule',
        label: '排程求解',
        hint: '逐段指定 HFSS／SIwave 並依序求解，完成後匯出 Touchstone。',
        requires: ['segment'],
      },
      {
        key: 'remotepack',
        label: '遠端求解包',
        hint: '打包成可在求解機直接執行的資料夾，跑完再收回結果。',
        requires: ['schedule'],
      },
    ],
  },
  {
    title: '結果',
    tasks: [
      {
        key: 'cascade',
        label: '電路串接',
        hint: '把各段 Touchstone 串接回完整通道。',
        requires: ['segment'],
        requiresNote: '或改用「外部 S 參數檔」模式，直接載入既有 .sNp（不需要載入電路板）。',
      },
      {
        key: 'sparam',
        label: 'S 參數檢視',
        hint: '串接結果的插入／回波損耗與串音，可切換單端與差動。',
        requires: ['cascade'],
      },
      {
        key: 'fidelity',
        label: '分段對照',
        hint: '另求解一次完整板作為基準，與分段串接結果並列比較。',
        requires: ['cascade'],
      },
      {
        key: 'eye',
        label: '眼圖',
        hint: '以串接後 Touchstone 直接求解 QuickEye 眼圖。',
        requires: ['cascade'],
      },
      {
        key: 'report',
        label: '一鍵 HTML 報告',
        hint: '保存各結果畫面的最新快照，加入公司品牌與浮水印後產生自包含 HTML 報告。',
      },
    ],
  },
]

function flatten(tasks: TaskDef[]): TaskDef[] {
  return tasks.flatMap(task => [task, ...flatten(task.children ?? [])])
}

export const ALL_TASKS: TaskDef[] = flatten(
  TASK_GROUPS.flatMap(group => group.tasks))

/** 首次啟動的預設組：能一路走完的最短路徑。
 *
 *  刻意不含選用的前處理與進階檢視——新使用者第一次打開若看到全部項目，就等於
 *  沒有解決「功能太多」這件事。日後新增功能**一律不進這組**，由使用者自己開，
 *  否則預設組會隨版本越長越大而失去意義。
 */
export const DEFAULT_TASKS: TaskKey[] = [
  'load', 'cutout', 'segment', 'schedule', 'cascade', 'sparam',
]

export type TaskFlags = Record<TaskKey, boolean>

export function makeFlags(keys: Iterable<TaskKey>): TaskFlags {
  const set = new Set(keys)
  const flags = {} as TaskFlags
  for (const task of ALL_TASKS) flags[task.key] = set.has(task.key)
  return flags
}

/** 缺少前置任務的項目；只用於提示，不阻擋。 */
export function missingPrerequisites(
  flags: TaskFlags,
): { task: TaskDef; missing: TaskDef[] }[] {
  const byKey = new Map(ALL_TASKS.map(task => [task.key, task]))
  const result: { task: TaskDef; missing: TaskDef[] }[] = []
  for (const task of ALL_TASKS) {
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

export function loadSavedTasks(): TaskKey[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const valid = new Set(ALL_TASKS.map(task => task.key))
    // 過濾掉已不存在的鍵：舊版存下來的項目若被移除，不該讓整份設定失效。
    return parsed.filter((key): key is TaskKey => valid.has(key))
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
