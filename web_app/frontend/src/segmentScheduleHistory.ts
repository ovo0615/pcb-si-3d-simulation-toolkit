/**
 * 分段排程的執行歷史：單次紀錄的各段明細與結果篩選。
 *
 * 紀錄由後端 segment_schedule_history.py 寫在 segments.json 旁的
 * segment_schedule_runs/。缺的欄位（舊紀錄、沒開始的段）一律寫「未記錄」，
 * 不留白也不編。
 */

import { messagesFor } from './i18n/catalog'
import type { Lang } from './i18n/lang'
import { failureText } from './segmentFailure'
import type { SegmentFailure } from './segmentFailure'

export type ScheduleFilter = 'all' | 'problem' | 'done'

interface ScheduleSegment {
  index?: number
  solver?: string
  mode?: string
  status?: string
  reused?: boolean
  started_at?: number | null
  finished_at?: number | null
  touchstone?: string | null
  failure?: SegmentFailure | null
  convergence_note?: string
  convergence_note_en?: string
  dc_note?: string
  dc_note_en?: string
}

const pad = (n: number) => String(n).padStart(2, '0')

function stamp(at: unknown): { date: string, time: string } | null {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  const d = new Date(at * 1000)
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  }
}

/** 開始→結束；同一天的結束只寫時分秒。 */
function span(start: unknown, end: unknown, notRecorded: string): string {
  const a = stamp(start)
  const b = stamp(end)
  const left = a ? `${a.date} ${a.time}` : notRecorded
  const right = b ? (a && a.date === b.date ? b.time : `${b.date} ${b.time}`) : notRecorded
  return `${left} → ${right}`
}

function pick(map: Record<string, string>, key: unknown): string {
  const k = String(key ?? '')
  return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : ''
}

/** 展開單次紀錄時的明細列：第一列整批摘要，之後每段一列，失敗段多一列原因。 */
export function scheduleSegmentLines(manifest: any, lang: Lang | string): string[] {
  const tx = messagesFor(lang as Lang).runHistory
  const none = tx.notRecorded
  const schedule = manifest?.schedule || {}
  const segments: ScheduleSegment[] = Array.isArray(manifest?.segments) ? manifest.segments : []
  const lines = [tx.scheduleSummary(
    pick(tx.scheduleMode, schedule.mode) || none,
    pick(tx.scheduleSolver, schedule.solver) || String(schedule.solver || none),
    typeof schedule.segment_count === 'number' ? schedule.segment_count : segments.length)]
  if (!segments.length) {
    lines.push(tx.scheduleNoSegments)
    return lines
  }
  for (const seg of [...segments].sort((a, b) => Number(a.index) - Number(b.index))) {
    const status = pick(tx.segmentStatus, seg.status) || String(seg.status || none)
    const output = seg.touchstone ? String(seg.touchstone).split(/[\\/]/).pop() || none : '—'
    lines.push(tx.scheduleSegment(
      seg.index ?? '?',
      seg.solver ? String(seg.solver).toUpperCase() : none,
      seg.reused ? `${status}${tx.reusedTag}` : status,
      span(seg.started_at, seg.finished_at, none),
      output))
    // 跑滿輪數未收斂仍算完成；提示不跟著段走，歷史上看起來就像正常收斂。
    const note = lang === 'en' && seg.convergence_note_en ? seg.convergence_note_en : seg.convergence_note
    if (note) lines.push(tx.scheduleConvergence(String(note)))
    const dcNote = lang === 'en' && seg.dc_note_en ? seg.dc_note_en : seg.dc_note
    if (dcNote) lines.push(String(dcNote))
    if (seg.failure && seg.failure.text) {
      const at = stamp(seg.failure.at)
      lines.push(tx.scheduleReason(failureText(seg.failure, lang, none),
        String(seg.failure.code || none), at ? `${at.date} ${at.time}` : none))
    }
  }
  return lines
}

const PROBLEM = new Set(['failed', 'partial', 'stopped', 'interrupted', 'cleanup_pending',
  'crashed', 'error', 'aborted'])
const SUCCESS = new Set(['done', 'completed', 'success'])

/** 篩選：全部／有失敗或停止／全部完成。讀不到的紀錄只在「全部」出現。 */
export function matchesScheduleFilter(row: { status?: string, readable?: boolean },
                                      filter: ScheduleFilter): boolean {
  if (filter === 'all') return true
  const status = String(row.status || '')
  return filter === 'problem' ? PROBLEM.has(status) : SUCCESS.has(status)
}
