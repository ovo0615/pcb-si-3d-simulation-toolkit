// 入口介面：勾選這次要用的模擬項目。
//
//
// 版面刻意壓在一個視窗內、不要求捲動：入口的作用是「一眼看完所有選項再決定」，
// 需要捲動才看得到的項目等於沒被看見。因此分兩欄、行高壓縮，說明文字放小。
import {
  ALL_TASKS,
  DEFAULT_TASKS,
  TASK_GROUPS,
  missingPrerequisites,
  type TaskDef,
  type TaskFlags,
  type TaskKey,
} from '../taskConfig'

interface Props {
  flags: TaskFlags
  onToggle: (key: TaskKey, checked: boolean) => void
  onSetAll: (keys: TaskKey[]) => void
  onStart: () => void
  /** 由主畫面回來調整時為 true，用來把「開始」改成「回到工具」。 */
  returning?: boolean
  /** 退場中：播完淡出動畫才真的卸載，畫面不會直接閃掉。 */
  closing?: boolean
  /** 退場動畫播完了，呼叫端可以卸載本元件。 */
  onClosed?: () => void
}

const FONT = '"Calibri", "Microsoft JhengHei", sans-serif'

type TaskIconKind =
  | 'board' | 'cutout' | 'stackup' | 'backdrill' | 'cleanup' | 'ports'
  | 'segment' | 'schedule' | 'remotepack' | 'cascade' | 'sparam' | 'eye' | 'tdr' | 'report'
  | 'models'

const TASK_ICON_KIND: Partial<Record<TaskKey, TaskIconKind>> = {
  load: 'board',
  cutout: 'cutout',
  stackup: 'stackup',
  backdrill: 'backdrill',
  cleanup: 'cleanup',
  ports: 'ports',
  segment: 'segment',
  schedule: 'schedule',
  remotepack: 'remotepack',
  cascade: 'cascade',
  sparam: 'sparam',
  eye: 'eye',
  models: 'models',
  tdr: 'tdr',
  report: 'report',
}

/**
 * 入口圖示：使用同一套 SVG 線稿，讓輸入、前處理、分析與結果各自有清楚的視覺語意。
 * SVG 直接隨畫面輸出，不需要額外圖片檔，也不會因縮放失真。
 */
function TaskIcon({ kind }: { kind: TaskIconKind }) {
  const labels: Record<TaskIconKind, string> = {
    board: '電路板圖示', cutout: '局部裁切圖示', stackup: '疊構圖示',
    backdrill: '背鑽圖示', cleanup: 'Layout 清理圖示', ports: 'Port 圖示',
    segment: 'N 段分割圖示', schedule: '排程求解圖示', remotepack: '遠端求解包圖示',
    cascade: '電路串接圖示', sparam: 'S 參數圖示', eye: '眼圖圖示',
    tdr: 'TDR 圖示', report: 'HTML 報告圖示',
    models: 'IBIS 模型與眼圖分析圖示',
  }

  return (
    <svg className="task-picker-icon" viewBox="0 0 64 64" role="img" aria-label={labels[kind]}>
      {kind === 'board' && <>
        <rect x="7" y="11" width="43" height="42" rx="5" fill="#132b3b" stroke="#63c5f2" strokeWidth="2" />
        <path d="M13 21h13v8h9v-8h10M13 40h10v-8h12v13h10" fill="none" stroke="#73d6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="17" r="2" fill="#ffbd5a" /><circle cx="43" cy="47" r="2" fill="#ffbd5a" />
        <rect x="18" y="34" width="7" height="7" rx="1" fill="#2f79a0" stroke="#b3ebff" />
        <rect x="32" y="16" width="8" height="7" rx="1" fill="#2f79a0" stroke="#b3ebff" />
        <path d="M49 32h10m-5-5 5 5-5 5" fill="none" stroke="#ffbd5a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>}
      {kind === 'cutout' && <>
        <rect x="7" y="11" width="43" height="42" rx="5" fill="#132b3b" stroke="#63869b" strokeWidth="2" />
        <path d="M13 22h12v7h10v-7h10M13 41h9v-8h13v12h10" fill="none" stroke="#6eb3d0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity=".75" />
        <circle cx="17" cy="18" r="2" fill="#7fd1ff" opacity=".8" />
        <path d="M14 29h25v20H14z" fill="#f59e0b" fillOpacity=".18" stroke="#ffb347" strokeWidth="2.4" strokeDasharray="4 3" />
        <path d="M14 35v-6h6M39 43v6h-6" fill="none" stroke="#ffe0a3" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M46 20l11 11m0-11L46 31" stroke="#ff8b5c" strokeWidth="2.5" strokeLinecap="round" />
      </>}
      {kind === 'stackup' && <>
        <rect x="12" y="10" width="38" height="9" rx="2" fill="#392f62" stroke="#b6a4ff" strokeWidth="1.8" />
        <rect x="9" y="22" width="38" height="9" rx="2" fill="#244f63" stroke="#73d6ff" strokeWidth="1.8" />
        <rect x="15" y="34" width="38" height="9" rx="2" fill="#644d2b" stroke="#ffca75" strokeWidth="1.8" />
        <rect x="11" y="46" width="38" height="8" rx="2" fill="#24563d" stroke="#8fe3aa" strokeWidth="1.8" />
        <path d="M54 15v34" stroke="#a8b8ca" strokeWidth="1.4" strokeDasharray="2 3" />
      </>}
      {kind === 'backdrill' && <>
        <path d="M20 9v44M38 9v44" stroke="#8bd6ee" strokeWidth="3" strokeLinecap="round" />
        <circle cx="20" cy="16" r="5" fill="#173c50" stroke="#73d6ff" strokeWidth="2" /><circle cx="38" cy="27" r="5" fill="#173c50" stroke="#73d6ff" strokeWidth="2" />
        <path d="M12 43h16M30 43h16M13 53h14" stroke="#ffbd5a" strokeWidth="3" strokeLinecap="round" />
        <path d="M51 10v28m-5-5 5 5 5-5" fill="none" stroke="#ff8b5c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>}
      {kind === 'cleanup' && <>
        <path d="M15 50l26-26" stroke="#ffbd5a" strokeWidth="6" strokeLinecap="round" />
        <path d="M37 19l7-7 8 8-7 7z" fill="#5ec7e8" stroke="#b9f0ff" strokeWidth="2" />
        <path d="M11 52h20M13 57h14" stroke="#8fe3aa" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M48 36l3-5m3 8 4-3M44 29l-1-5" stroke="#ff8b5c" strokeWidth="2" strokeLinecap="round" />
      </>}
      {kind === 'ports' && <>
        <rect x="10" y="20" width="30" height="24" rx="4" fill="#18394b" stroke="#73d6ff" strokeWidth="2" />
        <circle cx="18" cy="32" r="4" fill="#ffbd5a" /><circle cx="32" cy="32" r="4" fill="#ffbd5a" />
        <path d="M40 26h12v12H40M52 32h7m-3-4 3 4-3 4" fill="none" stroke="#8fe3aa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 12v6m8-6v6m8-6v6" stroke="#b3ebff" strokeWidth="2" strokeLinecap="round" />
      </>}
      {kind === 'segment' && <>
        <rect x="7" y="18" width="50" height="28" rx="5" fill="#19323b" stroke="#73d6ff" strokeWidth="2" />
        <path d="M23 18v28M40 18v28" stroke="#ffb347" strokeWidth="2" strokeDasharray="4 3" />
        <path d="M12 32h7m26 0h7" stroke="#8fe3aa" strokeWidth="2" strokeLinecap="round" />
        <circle cx="16" cy="25" r="2" fill="#b3ebff" /><circle cx="31" cy="38" r="2" fill="#b3ebff" /><circle cx="48" cy="26" r="2" fill="#b3ebff" />
        <text x="15" y="14" fill="#ffca75" fontSize="7" fontWeight="700">1</text><text x="32" y="14" fill="#ffca75" fontSize="7" fontWeight="700">2</text><text x="49" y="14" fill="#ffca75" fontSize="7" fontWeight="700">3</text>
      </>}
      {kind === 'schedule' && <>
        <circle cx="25" cy="32" r="17" fill="#18394b" stroke="#73d6ff" strokeWidth="2" />
        <path d="M25 21v12l8 5M25 10v4M13 14l3 3" fill="none" stroke="#b3ebff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M45 22h13M45 31h13M45 40h9" stroke="#8fe3aa" strokeWidth="3" strokeLinecap="round" />
      </>}
      {kind === 'remotepack' && <>
        <path d="M9 22l16-9 27 9-16 9z" fill="#3b315e" stroke="#c3b2ff" strokeWidth="2" />
        <path d="M9 22v23l27 10V31M52 22v20l-16 13" fill="#1d3345" stroke="#73d6ff" strokeWidth="2" strokeLinejoin="round" />
        <path d="M16 35h17m-6-6 6 6-6 6" fill="none" stroke="#ffbd5a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </>}
      {kind === 'cascade' && <>
        <rect x="6" y="23" width="16" height="18" rx="3" fill="#193b42" stroke="#8fe3aa" strokeWidth="2" />
        <rect x="25" y="23" width="16" height="18" rx="3" fill="#193b42" stroke="#8fe3aa" strokeWidth="2" />
        <rect x="44" y="23" width="14" height="18" rx="3" fill="#193b42" stroke="#8fe3aa" strokeWidth="2" />
        <path d="M22 32h3m16 0h3m-5-4 5 4-5 4" fill="none" stroke="#ffbd5a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M11 17h42" stroke="#73d6ff" strokeWidth="2" strokeDasharray="3 3" />
      </>}
      {kind === 'sparam' && <>
        <path d="M10 11v43h48M18 46c5-17 8 3 14-13s9 8 14-8 7-3 12-12" fill="none" stroke="#73d6ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 22h48M10 34h48" stroke="#466273" strokeWidth="1" strokeDasharray="2 3" />
        <circle cx="32" cy="33" r="3" fill="#ffbd5a" /><circle cx="46" cy="25" r="3" fill="#8fe3aa" />
      </>}
      {kind === 'eye' && <>
        <path d="M7 32s10-16 25-16 25 16 25 16-10 16-25 16S7 32 7 32z" fill="#18394b" stroke="#73d6ff" strokeWidth="2" />
        <circle cx="32" cy="32" r="7" fill="#ffbd5a" /><circle cx="32" cy="32" r="3" fill="#18394b" />
        <path d="M14 39c7-10 11-10 18 0s11 10 18 0M14 25c7 10 11 10 18 0s11-10 18 0" fill="none" stroke="#8fe3aa" strokeWidth="1.8" opacity=".9" />
      </>}
      {kind === 'tdr' && <>
        <path d="M9 11v43h49" stroke="#a8b8ca" strokeWidth="2" strokeLinecap="round" />
        <path d="M12 42h14V25h10v11h7V20h15" fill="none" stroke="#ffbd5a" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 20h44M13 31h44" stroke="#466273" strokeWidth="1" strokeDasharray="2 3" />
        <circle cx="36" cy="36" r="3" fill="#ff8b5c" />
      </>}
      {kind === 'report' && <>
        <path d="M16 8h25l10 10v38H16z" fill="#19394c" stroke="#73d6ff" strokeWidth="2" strokeLinejoin="round" />
        <path d="M41 8v11h10M22 29h22M22 36h22" stroke="#b3ebff" strokeWidth="2" strokeLinecap="round" />
        <path d="M23 49l7-7 5 4 8-10" fill="none" stroke="#8fe3aa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M48 46h10m-5-5 5 5-5 5" fill="none" stroke="#ffbd5a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </>}
      {kind === 'models' && <>
        <path d="M10 12h19l5 5h20v35H10z" fill="#18394b" stroke="#73d6ff" strokeWidth="2" strokeLinejoin="round" />
        <path d="M17 25h29M17 33h21" stroke="#b3ebff" strokeWidth="2" strokeLinecap="round" />
        <path d="M18 44s6-8 14-8 14 8 14 8-6 8-14 8-14-8-14-8z" fill="#332d55" stroke="#c3b2ff" strokeWidth="2" />
        <circle cx="32" cy="44" r="4" fill="#ffbd5a" />
        <path d="M48 41h10m-5-5 5 5-5 5" fill="none" stroke="#8fe3aa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </>}
    </svg>
  )
}

/** 畫一個項目；有 children 時，子選項只在父項目勾選時出現。 */
function renderTask(
  task: TaskDef,
  flags: TaskFlags,
  onToggle: (key: TaskKey, checked: boolean) => void,
  depth = 0,
) {
  const on = flags[task.key]
  const iconKind = TASK_ICON_KIND[task.key]
  return (
    <div key={task.key}>
      <label
        className="task-card"
        data-on={on ? 'yes' : 'no'}
        style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          padding: depth ? '10px 14px' : '15px 18px',
          minHeight: depth ? 72 : 88,
          borderRadius: 8, cursor: 'pointer',
          // 邊框與底色交給 CSS 的 `[data-on]`：行內樣式蓋得過 class，
          // 寫在這裡就沒辦法再加 :hover。
        }}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={event => onToggle(task.key, event.target.checked)}
          style={{ marginTop: 5, flexShrink: 0, width: 19, height: 19 }}
        />
        {iconKind && <TaskIcon kind={iconKind} />}
        <span style={{ minWidth: 0 }}>
          <span style={{ fontSize: depth ? 15 : 18, fontWeight: 700 }}>
            {task.label}
          </span>
          {/* 預估耗時：刻意壓到比說明文字更淡、字重不加粗，讓它讀起來是名稱的
              附註而不是第二個標題。nowrap 是必要的——「約 5～30 分」一旦在
              波浪號斷行，看起來就像兩個不相干的數字。 */}
          {task.eta && (
            <span
              title="預估耗時（靜態估計，實際依板子大小與機器而定）"
              style={{
                marginLeft: 7, fontSize: 10, fontWeight: 400,
                color: '#8d9db0', whiteSpace: 'nowrap',
                border: '1px solid #2a3644', borderRadius: 999,
                padding: '0 5px', verticalAlign: '2px',
              }}
            >
              {task.eta}
            </span>
          )}
          <span style={{
            display: 'block', fontSize: depth ? 13 : 14, color: '#a8b8ca',
            marginTop: 5, lineHeight: 1.55,
          }}>
            {task.hint}
          </span>
          {/* 取消勾選的後果直接寫在這裡，不必等使用者勾了別的東西才跳警告 */}
          {!on && task.offNote && (
            <span style={{
              display: 'block', fontSize: 13, color: '#ffd98a',
              marginTop: 4, lineHeight: 1.5,
            }}>
              {task.offNote}
            </span>
          )}
        </span>
      </label>

      {task.children && task.children.length > 0 && on && (
        <div style={{
          marginTop: 5, marginLeft: 16, paddingLeft: 12,
          borderLeft: '2px solid #2a3644',
          display: 'grid', gap: 5,
        }}>
          <div style={{ fontSize: 13, color: '#9eafc3' }}>
            這次要對這片板子做什麼：
          </div>
          {task.children.map(child => renderTask(child, flags, onToggle, depth + 1))}
        </div>
      )}
    </div>
  )
}

export default function TaskPicker(
  { flags, onToggle, onSetAll, onStart, returning, closing, onClosed }: Props,
) {
  const chosen = ALL_TASKS.filter(task => flags[task.key])
  const gaps = missingPrerequisites(flags)

  return (
    <div
      className={'task-picker-root' + (closing ? ' task-picker-root--closing' : '')}
      // 只認自己那一顆動畫。裡面四組卡片各自有進場動畫，它們的 animationend
      // 一樣會冒泡上來——不過濾的話，入口會在第一組卡片浮完就整個消失。
      onAnimationEnd={event => {
        if (closing && event.target === event.currentTarget) onClosed?.()
      }}
      style={{
      // fixed 而非 absolute：要蓋掉標題列與選單列，不受任何定位祖先影響。
      position: 'fixed', inset: 0, zIndex: 9998,
      background: '#0f1216', color: '#d8e1ec', fontFamily: FONT,
      display: 'flex', flexDirection: 'column',
      padding: '20px 28px 16px',
    }}>
      <div style={{ flexShrink: 0, marginBottom: 10 }}>
        <div style={{ fontSize: 36, lineHeight: 1.15, fontWeight: 800, letterSpacing: 0.4, color: '#f1f7ff' }}>
          PCB SI 3D 模擬分析工具
        </div>
        <div style={{ fontSize: 16, color: '#a8b8ca', marginTop: 8 }}>
          勾選這次要用的項目，介面只會顯示這些；之後可從左上角「調整項目」隨時改。
        </div>
      </div>

      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '18px 24px', alignContent: 'start',
        // CSS Grid 預設 alignItems: stretch，會把同一列裡較短的那組硬拉伸到
        // 跟最高的那組一樣高，在短的那組底下留下一大片空白。改成 start
        // 讓每組只佔自己內容的高度。
        alignItems: 'start',
      }}>
        {TASK_GROUPS.map(group => (
          <div key={group.title} className="task-picker-group">
            <div style={{
              fontSize: 16, fontWeight: 700, color: '#7fd1ff',
              letterSpacing: 0.5, marginBottom: 9,
            }}>
              {group.title}
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {group.tasks.map(task => renderTask(task, flags, onToggle))}
            </div>
          </div>
        ))}
      </div>

      {gaps.length > 0 && (
        <div style={{
          flexShrink: 0, marginTop: 10,
          border: '1px solid #6a5326', background: '#221c10',
          borderRadius: 8, padding: '8px 14px',
            fontSize: 14, lineHeight: 1.7, color: '#ffd98a',
          maxHeight: 90, overflowY: 'auto',
        }}>
          <b>以下項目缺少前置，仍可繼續，但流程可能接不起來：</b>
          {gaps.map(({ task, missing }) => (
            <div key={task.key}>
              「{task.label}」需要：{missing.map(m => m.label).join('、')}
              {task.requiresNote ? `　（${task.requiresNote}）` : ''}
            </div>
          ))}
        </div>
      )}

      {/* 這一列的每一顆按鈕都要 `flex: 0 0 auto`。`.btn--primary` 的樣式帶著
          `width: 100%`（它在左側面板是整條的主要動作），放進 flex 列裡會把
          自己撐滿、把旁邊兩顆擠到只剩兩個字寬——「全選」斷成兩行、「還原預設組」
          斷成「還原預設／組」。不會報錯，只是看起來壞掉。 */}
      <div style={{
        flexShrink: 0, display: 'flex', gap: 10, alignItems: 'center',
        borderTop: '1px solid #242c36', paddingTop: 10, marginTop: 10,
      }}>
        <button
          className="btn--primary"
          onClick={onStart}
          disabled={chosen.length === 0}
          style={{
            flex: '0 0 auto', width: 'auto', minWidth: 180,
            padding: '11px 30px', fontSize: 16, fontWeight: 700,
            whiteSpace: 'nowrap',
          }}
        >
          {returning ? '回到工具' : '開始'}
        </button>
        <button
          className="btn"
          style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
          onClick={() => onSetAll(ALL_TASKS.map(task => task.key))}
        >
          全選
        </button>
        <button
          className="btn"
          style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
          onClick={() => onSetAll(DEFAULT_TASKS)}
        >
          還原預設組
        </button>
        <span style={{
          flex: '0 1 auto', marginLeft: 'auto', textAlign: 'right',
          fontSize: 11.5, color: '#8d9db0', lineHeight: 1.5,
        }}>
          {chosen.length === 0 ? '請至少勾選一項' : `已選 ${chosen.length} 項`}
          　·　勾選記在這台瀏覽器
        </span>
      </div>
    </div>
  )
}
