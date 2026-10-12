// 功能分級：主要／Beta Option（#0131）。
//
// 分級只決定維護優先順序（同嚴重度先修主要功能），**不是**結果有效性：Beta 不等於
// 失敗、主要也不等於 Pass。分級看登錄檔的 `tier` 欄位，不看 ID 前綴——B02 是主要、
// M09 是 Beta（Jeff 2026-10-12）。
//
// 登錄檔 `featureTiers.json` 前後端共用：後端 `app/feature_tiers.json` 是逐位元組
// 複本（測試釘住），API 對照規則兩邊各實作一次、用同一份案例對答案。
//
// 不碰 React：Node 測試直接跑。

import registry from './featureTiers.json'
import { messagesFor } from './i18n/catalog'
import type { Lang } from './i18n/lang'
import type { Messages } from './i18n/zh-TW'

export type FeatureTier = 'main' | 'beta'
export type FeatureTierMessages = Messages['featureTier']

interface ApiRule {
  path: string
  field?: string
  equals?: unknown
  /** 欄位是大於 0 的數字才算（不看 `equals`）。 */
  positive?: boolean
}

export interface FeatureDef {
  id: string
  tier: FeatureTier
  /** 所屬的入口任務（taskConfig 的鍵）。 */
  task: string
  /** `task`＝這個任務本身；`mode`＝任務裡的某個選項或模式。 */
  scope: 'task' | 'mode'
  reason: string
  api?: ApiRule[]
}

export const FEATURE_POLICY_VERSION: string = registry.policy_version
export const FEATURES: readonly FeatureDef[] = registry.features as FeatureDef[]

const BY_ID = new Map(FEATURES.map(feature => [feature.id, feature]))

export function featureTier(id: string): FeatureTier | undefined {
  return BY_ID.get(id)?.tier
}

export function isBetaFeature(id: string): boolean {
  return featureTier(id) === 'beta'
}

/** 代表這個任務本身的功能 ID（入口標籤的說明用）。 */
export function taskFeatureId(key: string): string | undefined {
  return FEATURES.find(f => f.task === key && f.scope === 'task')?.id
}

/** 任務本身的分級；登錄檔沒有的鍵（例如只留給遷移的 `eye`）視為主要。 */
export function taskTier(key: string): FeatureTier {
  return FEATURES.find(f => f.task === key && f.scope === 'task')?.tier ?? 'main'
}

/** 主要任務裡有 Beta 模式：入口只提示「含 Beta 選項」，不整卡降級。 */
export function taskHasBetaModes(key: string): boolean {
  return taskTier(key) === 'main'
    && FEATURES.some(f => f.task === key && f.scope === 'mode' && f.tier === 'beta')
}

export function splitByTier<T extends { key: string }>(items: readonly T[]): { main: T[]; beta: T[] } {
  return {
    main: items.filter(item => taskTier(item.key) !== 'beta'),
    beta: items.filter(item => taskTier(item.key) === 'beta'),
  }
}

export function betaTasksIn(keys: Iterable<string>): string[] {
  return [...keys].filter(key => taskTier(key) === 'beta')
}

/** 入口的「只選主要功能」：沿用傳入順序，拿掉 Beta 任務。 */
export function mainOnlySelection<K extends string>(all: readonly K[]): K[] {
  return all.filter(key => taskTier(key) !== 'beta')
}

function ordered(ids: Iterable<string>): string[] {
  const wanted = new Set(ids)
  return FEATURES.filter(f => wanted.has(f.id)).map(f => f.id)
}

// ── 由請求推導（與後端 feature_tiers.features_for_request 同一套規則）──

function requestPath(url: string): string {
  try {
    return new URL(url, 'http://localhost').pathname
  } catch {
    return url.split('?', 1)[0]
  }
}

function ruleMatches(rule: ApiRule, path: string, body: unknown): boolean {
  if (rule.path.includes('*')) {
    const pattern = new RegExp('^' + rule.path.split('*')
      .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*') + '$')
    if (!pattern.test(path)) return false
  } else if (path !== rule.path) {
    return false
  }
  if (!rule.field) return true
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false
  const value = (body as Record<string, unknown>)[rule.field]
  // 例：沿線取樣間距 > 0 才是批次（B19）；字串不算數字。
  if (rule.positive) return typeof value === 'number' && value > 0
  return value === rule.equals
}

/** 這個請求會用到的 Beta 項目。只有 POST（實際送出動作）才算使用。 */
export function betaFeaturesForRequest(method: string, url: string, body: unknown): string[] {
  if (String(method).toUpperCase() !== 'POST') return []
  const path = requestPath(url)
  return ordered(FEATURES
    .filter(f => f.tier === 'beta' && (f.api ?? []).some(rule => ruleMatches(rule, path, body)))
    .map(f => f.id))
}

// ── 執行前提示：每個分級版本只問一次 ─────────────────────────────

export const BETA_NOTICE_STORAGE_KEY = 'pcbsi.betaNotice.v1'

function ackMap(acked: unknown): Record<string, string> {
  return typeof acked === 'object' && acked !== null && !Array.isArray(acked)
    ? acked as Record<string, string> : {}
}

/** 還沒在目前分級版本下確認過的 Beta 項目。 */
export function pendingBetaNotice(ids: readonly string[], acked: unknown): string[] {
  const map = ackMap(acked)
  return ordered(ids.filter(id => isBetaFeature(id) && map[id] !== FEATURE_POLICY_VERSION))
}

export function acknowledgeBetaNotice(ids: readonly string[], acked: unknown): Record<string, string> {
  const next = { ...ackMap(acked) }
  for (const id of ids) next[id] = FEATURE_POLICY_VERSION
  return next
}

export function featureName(id: string, t: FeatureTierMessages): string {
  return (t.names as Record<string, string>)[id] ?? id
}

/** 執行前提示的全文：用到哪些、各自的限制，以及「只問一次」。 */
export function formatBetaNotice(ids: readonly string[], t: FeatureTierMessages): string {
  const names = ids.map(id => featureName(id, t))
  const limits = ids
    .map(id => [featureName(id, t), (t.limits as Record<string, string> | undefined)?.[id]] as const)
    .filter(([, limit]) => Boolean(limit))
    .map(([name, limit]) => `\n• ${name}${t.limitSep}${limit}`)
  return t.runNotice(names.join(t.listSep)) + limits.join('') + t.runNoticeOnce
}

export function betaNoticeText(ids: readonly string[], lang: Lang = 'zh-TW'): string {
  return formatBetaNotice(ids, messagesFor(lang).featureTier)
}

// ── 執行紀錄裡的分級 ─────────────────────────────────────────────

export type RecordedTier =
  | { state: 'unrecorded' }
  | { state: 'main'; policyVersion: string; olderPolicy: boolean }
  | { state: 'beta'; ids: string[]; policyVersion: string; olderPolicy: boolean }

/** 後端 manifest 的 `feature_tier`。沒有欄位＝未記錄，**不能**當成沒用 Beta。 */
export function describeRecordedTier(record: unknown): RecordedTier {
  if (typeof record !== 'object' || record === null) return { state: 'unrecorded' }
  const { policy_version: version, beta_features: ids } = record as Record<string, unknown>
  if (!Array.isArray(ids)) return { state: 'unrecorded' }
  const policyVersion = typeof version === 'string' ? version : ''
  const olderPolicy = policyVersion !== FEATURE_POLICY_VERSION
  const list = ids.filter((id): id is string => typeof id === 'string')
  return list.length
    ? { state: 'beta', ids: list, policyVersion, olderPolicy }
    : { state: 'main', policyVersion, olderPolicy }
}
