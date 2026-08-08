// 入口介面：勾選這次要用的模擬項目。
//
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
import {
  ALL_TASKS,
  DEFAULT_TASKS,
  TASK_GROUPS,
  missingPrerequisites,
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

export default function TaskPicker(
  { flags, onToggle, onSetAll, onStart, returning }: Props,
) {
  const chosen = ALL_TASKS.filter(task => flags[task.key])
  const gaps = missingPrerequisites(flags)

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50, overflowY: 'auto',
      background: 'var(--bg, #0f1216)', color: '#d8e1ec', fontFamily: FONT,
      padding: '28px 32px',
    }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <h1 style={{ fontSize: 21, margin: '0 0 4px', color: '#eaf1fa' }}>
          PCB SI 3D 模擬分析工具
        </h1>
        <div style={{ fontSize: 13, color: '#93a4b8', marginBottom: 20 }}>
          勾選這次要用的項目，介面只會顯示這些。之後可以隨時從上方「調整項目」改。
        </div>

        {TASK_GROUPS.map(group => (
          <div key={group.title} style={{ marginBottom: 18 }}>
            <div style={{
              fontSize: 12.5, fontWeight: 700, color: '#7fd1ff',
              letterSpacing: 0.5, marginBottom: 7,
            }}>
              {group.title}
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {group.tasks.map(task => (
                <label
                  key={task.key}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                    border: '1px solid ' + (flags[task.key] ? '#2f6d8f' : '#242c36'),
                    background: flags[task.key] ? '#152430' : '#12161c',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={flags[task.key]}
                    onChange={event => onToggle(task.key, event.target.checked)}
                    style={{ marginTop: 2, flexShrink: 0 }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {task.label}
                    </span>
                    <span style={{
                      display: 'block', fontSize: 11.5, color: '#8d9db0',
                      marginTop: 2, lineHeight: 1.5,
                    }}>
                      {task.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}

        {gaps.length > 0 && (
          <div style={{
            border: '1px solid #6a5326', background: '#221c10',
            borderRadius: 8, padding: '10px 13px', marginBottom: 16,
            fontSize: 12, lineHeight: 1.7, color: '#ffd98a',
          }}>
            <div style={{ fontWeight: 700, marginBottom: 3 }}>
              以下項目缺少前置，仍可繼續，但流程可能接不起來：
            </div>
            {gaps.map(({ task, missing }) => (
              <div key={task.key}>
                「{task.label}」需要：{missing.map(m => m.label).join('、')}
                {task.requiresNote ? `　（${task.requiresNote}）` : ''}
              </div>
            ))}
          </div>
        )}

        <div style={{
          display: 'flex', gap: 10, alignItems: 'center',
          borderTop: '1px solid #242c36', paddingTop: 14,
        }}>
          <button
            className="btn--primary"
            onClick={onStart}
            disabled={chosen.length === 0}
            style={{ padding: '8px 22px', fontSize: 14 }}
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
          <span style={{ fontSize: 12, color: '#8d9db0', marginLeft: 'auto' }}>
            {chosen.length === 0
              ? '請至少勾選一項'
              : `已選 ${chosen.length} 項`}
          </span>
        </div>

        <div style={{
          marginTop: 22, fontSize: 11, color: '#66798f', lineHeight: 1.7,
        }}>
          勾選會記在這台瀏覽器，下次開啟自動帶出。
          <br />
          此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
        </div>
      </div>
    </div>
  )
}
