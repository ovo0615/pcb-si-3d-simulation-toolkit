// 判斷頻寬的來源。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
//
// 「判斷頻寬」是求解器建議用的「這次要用到幾 GHz」，和掃頻上限（切面驗收與
// 求解真正掃到哪裡）是兩個值。原本它是分段頁上的一格手填欄位，加上一顆
// 「由資料率導出」：先套用內建規範、再按導出，規範帶入的頻寬就被洗掉，而且
// 畫面看不出現在的數字是從哪裡來的。
//
// 現在來源是明確的二選一——依規範／依資料率自訂——兩邊的值各自保存，切換
// 只改「用哪一個」，不洗掉另一邊。手動覆寫收進進階設定，優先於兩者。都沒有
// 就跟掃頻上限走（保守：高頻不會被低估）。

export type BandwidthMode = 'spec' | 'rate'

/** 內建規範帶入的頻寬。`name` 是設定檔名（含「內建｜」前綴），`label` 是顯示名。 */
export interface SpecBandwidth {
  name: string
  label: string
  labelEn: string
  ghz: number
  rateGbps: number | null
}

/** 由資料率導出的頻寬；`rateGbps` 是導出當下用的資料率。 */
export interface RateBandwidth {
  rateGbps: number
  ghz: number
  basis: string
}

export interface BandwidthState {
  mode: BandwidthMode
  spec: SpecBandwidth | null
  rate: RateBandwidth | null
  /** 資料率輸入框的原字串（1866 或 1.866 都收）。 */
  rateInput: string
  /** 進階覆寫（GHz）的原字串；空＝不覆寫。 */
  override: string
  /** 覆寫值的出處：空＝使用者在進階設定填的；`legacy:<設定檔名>`＝舊設定檔帶入。 */
  overrideOrigin: string
}

export type BandwidthSourceKind = 'override' | 'spec' | 'rate' | 'sweep' | 'none'

export interface ResolvedBandwidth {
  ghz: number | null
  source: BandwidthSourceKind
  /** 覆寫欄有填但不是正數：不採用，但要讓使用者看到。 */
  invalidOverride: boolean
  /** 依資料率自訂時，輸入框的資料率已經和導出時不同。 */
  staleRate: boolean
}

export const INITIAL_BANDWIDTH_STATE: BandwidthState = {
  mode: 'spec', spec: null, rate: null, rateInput: '', override: '', overrideOrigin: '',
}

/** DDR 的人講「1866」（MT/s），不是「1.866」（Gbps）。兩種都收——沒有任何
 *  介面會跑在 100 Gbps 以上，所以這個門檻不會誤判。 */
export function normalizeDataRate(typed: string | number): number | null {
  const value = Number(typed)
  if (String(typed).trim() === '' || !Number.isFinite(value) || value <= 0) return null
  return value >= 100 ? value / 1000 : value
}

function positive(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/** 依目前的來源算出判斷頻寬。順序：覆寫 → 選定的來源 → 掃頻上限。 */
export function resolveSolverBandwidth(
  state: BandwidthState, sweepMaxGHz: number | null,
): ResolvedBandwidth {
  const overrideText = String(state.override ?? '').trim()
  const override = positive(overrideText)
  const invalidOverride = overrideText !== '' && override === null
  const typedRate = normalizeDataRate(state.rateInput)
  const staleRate = state.mode === 'rate' && !!state.rate
    && typedRate !== null && Math.abs(typedRate - state.rate.rateGbps) > 1e-9
  const result = (ghz: number | null, source: BandwidthSourceKind): ResolvedBandwidth =>
    ({ ghz, source, invalidOverride, staleRate })
  if (override !== null) return result(override, 'override')
  if (state.mode === 'spec' && state.spec && positive(state.spec.ghz) !== null) {
    return result(state.spec.ghz, 'spec')
  }
  if (state.mode === 'rate' && state.rate && positive(state.rate.ghz) !== null) {
    return result(state.rate.ghz, 'rate')
  }
  const sweep = positive(sweepMaxGHz)
  return sweep !== null ? result(sweep, 'sweep') : result(null, 'none')
}

/** 判斷頻寬和掃頻上限對不對得上。高於掃頻＝需求頻段沒有被求解涵蓋。 */
export function bandwidthCoverage(
  ghz: number | null, sweepMaxGHz: number | null,
): 'ok' | 'aboveSweep' | 'belowSweep' {
  if (ghz === null || sweepMaxGHz === null || !(ghz > 0) || !(sweepMaxGHz > 0)) return 'ok'
  if (ghz > sweepMaxGHz + 1e-6) return 'aboveSweep'
  if (ghz < sweepMaxGHz - 1e-6) return 'belowSweep'
  return 'ok'
}

export interface BandwidthChange {
  fromSource: BandwidthSourceKind
  fromGhz: number | null
  toSource: BandwidthSourceKind
  toGhz: number | null
}

/** 切換二選一。兩邊的值都保留；回傳這次切換讓判斷頻寬從什麼變成什麼。 */
export function switchBandwidthMode(
  state: BandwidthState, to: BandwidthMode, sweepMaxGHz: number | null,
): { state: BandwidthState; change: BandwidthChange | null } {
  if (state.mode === to) return { state, change: null }
  const before = resolveSolverBandwidth(state, sweepMaxGHz)
  const next = { ...state, mode: to }
  const after = resolveSolverBandwidth(next, sweepMaxGHz)
  return {
    state: next,
    change: {
      fromSource: before.source, fromGhz: before.ghz,
      toSource: after.source, toGhz: after.ghz,
    },
  }
}

interface ProfilePayload {
  builtin?: boolean
  label?: string
  label_en?: string
  settings?: Record<string, any>
}

/** 套用設定檔時，頻寬相關欄位怎麼合併進目前的狀態。
 *
 *  - 內建規範：切到「依規範」，頻寬由規範帶入並記下來源；清掉覆寫（不然規範
 *    值不會生效）。資料率自訂的值保留，切回去就恢復。
 *  - 新版使用者設定檔（`bandwidthSchema: 2`）：原樣還原。
 *  - 舊版設定檔：沒有來源資訊。非空的 `usableBandwidthGHz` 當成**看得到的覆寫**，
 *    標明出自哪個設定檔，不悄悄當成自動值。缺的鍵保持現值（套用是合併）。 */
export function bandwidthFromProfile(
  state: BandwidthState, name: string, profile: ProfilePayload,
): BandwidthState {
  const settings = profile.settings || {}
  if (profile.builtin) {
    const ghz = positive(settings.usableBandwidthGHz)
    if (ghz === null) return state
    return {
      ...state,
      mode: 'spec',
      spec: {
        name,
        label: profile.label || name,
        labelEn: profile.label_en || profile.label || name,
        ghz,
        rateGbps: positive(settings.dataRateGbps),
      },
      override: '',
      overrideOrigin: '',
    }
  }
  if (settings.bandwidthSchema === 2) {
    return {
      mode: settings.bandwidthMode === 'rate' ? 'rate' : 'spec',
      spec: settings.bandwidthSpec ?? null,
      rate: settings.bandwidthRate ?? null,
      rateInput: String(settings.dataRateGbps ?? ''),
      override: String(settings.usableBandwidthGHz ?? ''),
      overrideOrigin: String(settings.bandwidthOverrideOrigin ?? ''),
    }
  }
  let next = state
  if ('dataRateGbps' in settings) {
    next = { ...next, rateInput: String(settings.dataRateGbps ?? '') }
  }
  if ('usableBandwidthGHz' in settings) {
    const text = String(settings.usableBandwidthGHz ?? '').trim()
    next = { ...next, override: text, overrideOrigin: text ? `legacy:${name}` : '' }
  }
  return next
}

/** 存設定檔用的欄位。`dataRateGbps`／`usableBandwidthGHz` 兩個舊鍵照樣寫，
 *  舊版程式讀得懂：前者是資料率，後者只放覆寫（空＝跟來源走）。 */
export function bandwidthProfileSettings(state: BandwidthState): Record<string, any> {
  return {
    bandwidthSchema: 2,
    bandwidthMode: state.mode,
    bandwidthSpec: state.spec,
    bandwidthRate: state.rate,
    bandwidthOverrideOrigin: state.overrideOrigin,
    dataRateGbps: state.rateInput,
    usableBandwidthGHz: state.override,
  }
}

/** 存設定檔時寫入的鍵（套用時用來算「缺了哪些欄位」）。 */
export const BANDWIDTH_PROFILE_KEYS = Object.keys(bandwidthProfileSettings(INITIAL_BANDWIDTH_STATE))
