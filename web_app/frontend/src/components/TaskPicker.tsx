// 入口介面：勾選這次要用的模擬項目。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
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
}

const FONT = '"Calibri", "Microsoft JhengHei", sans-serif'

/** 畫一個項目；有 children 時，子選項只在父項目勾選時出現。 */
function renderTask(
  task: TaskDef,
  flags: TaskFlags,
  onToggle: (key: TaskKey, checked: boolean) => void,
  depth = 0,
) {
  const on = flags[task.key]
  return (
    <div key={task.key}>
      <label
        style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          padding: depth ? '7px 12px' : '10px 14px',
          borderRadius: 8, cursor: 'pointer',
          border: '1px solid ' + (on ? '#2f6d8f' : '#242c36'),
          background: on ? '#152430' : '#12161c',
        }}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={event => onToggle(task.key, event.target.checked)}
          style={{ marginTop: 3, flexShrink: 0, width: 15, height: 15 }}
        />
        <span style={{ minWidth: 0 }}>
          <span style={{ fontSize: depth ? 13.5 : 15, fontWeight: 600 }}>
            {task.label}
          </span>
          <span style={{
            display: 'block', fontSize: depth ? 11.5 : 12.5, color: '#96a6ba',
            marginTop: 3, lineHeight: 1.5,
          }}>
            {task.hint}
          </span>
          {/* 取消勾選的後果直接寫在這裡，不必等使用者勾了別的東西才跳警告 */}
          {!on && task.offNote && (
            <span style={{
              display: 'block', fontSize: 11.5, color: '#ffd98a',
              marginTop: 3, lineHeight: 1.5,
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
          <div style={{ fontSize: 11.5, color: '#8d9db0' }}>
            這次要對這片板子做什麼：
          </div>
          {task.children.map(child => renderTask(child, flags, onToggle, depth + 1))}
        </div>
      )}
    </div>
  )
}

export default function TaskPicker(
  { flags, onToggle, onSetAll, onStart, returning }: Props,
) {
  const chosen = ALL_TASKS.filter(task => flags[task.key])
  const gaps = missingPrerequisites(flags)

  return (
    <div style={{
      // fixed 而非 absolute：要蓋掉標題列與選單列，不受任何定位祖先影響。
      position: 'fixed', inset: 0, zIndex: 9998,
      background: '#0f1216', color: '#d8e1ec', fontFamily: FONT,
      display: 'flex', flexDirection: 'column',
      padding: '14px 24px 12px',
    }}>
      <div style={{ flexShrink: 0, marginBottom: 10 }}>
        <div style={{ fontSize: 21, fontWeight: 700, color: '#eaf1fa' }}>
          PCB SI 3D 模擬分析工具
        </div>
        <div style={{ fontSize: 13.5, color: '#93a4b8', marginTop: 3 }}>
          勾選這次要用的項目，介面只會顯示這些；之後可從左上角「調整項目」隨時改。
        </div>
      </div>

      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: '14px 24px', alignContent: 'start',
        // CSS Grid 預設 alignItems: stretch，會把同一列裡較短的那組硬拉伸到
        // 跟最高的那組一樣高，在短的那組底下留下一大片空白。改成 start
        // 讓每組只佔自己內容的高度。
        alignItems: 'start',
      }}>
        {TASK_GROUPS.map(group => (
          <div key={group.title}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#7fd1ff',
              letterSpacing: 0.5, marginBottom: 7,
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
          fontSize: 12.5, lineHeight: 1.7, color: '#ffd98a',
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

      <div style={{
        flexShrink: 0, display: 'flex', gap: 10, alignItems: 'center',
        borderTop: '1px solid #242c36', paddingTop: 10, marginTop: 10,
      }}>
        <button
          className="btn--primary"
          onClick={onStart}
          disabled={chosen.length === 0}
          style={{ padding: '7px 22px', fontSize: 13.5 }}
        >
          {returning ? '回到工具' : '開始'}
        </button>
        <button
          className="btn"
          onClick={() => onSetAll(ALL_TASKS.map(task => task.key))}
        >
          全選
        </button>
        <button className="btn" onClick={() => onSetAll(DEFAULT_TASKS)}>
          還原預設組
        </button>
        <span style={{ fontSize: 11.5, color: '#8d9db0', marginLeft: 'auto' }}>
          {chosen.length === 0 ? '請至少勾選一項' : `已選 ${chosen.length} 項`}
          　·　勾選記在這台瀏覽器
        </span>
      </div>
    </div>
  )
}
