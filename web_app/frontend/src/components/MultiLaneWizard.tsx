// 眼圖精靈的多埠分支：多道串擾分析與位元組通道（ADR-0044、ADR-0045、ADR-0046）。
// 只嵌在眼圖精靈裡（ADR-0067 收掉「進階：多埠通道」頁籤），通道與速率由精靈第 1、2 步提供。
//
// 這個面板的三個設計要點都直接對應 ADR，改動前請先讀那三份：
//
//  * 綁定**整批確認**而不是逐埠確認。60 個 Port 逐一確認等於這個功能沒人會
//    用；分級的依據是可稽核的證據（腳位號與訊號名對得上幾個鍵），不是信心
//    分數，因此畫面要顯示的是證據而不是百分比。
//  * 待決定的項目**不給預設值**。ODT 阻值與驅動阻抗由記憶體控制器設定決定，
//    工具沒有依據代選；未綁定埠的處置也是——開路與終結會給出不同的串擾
//    結果，兩者都不是安全預設。這些欄位在畫面上是必填，不是「預設值可改」。
//  * 隨機碼型的**涵蓋率必須顯示出來**。八條道跑 2000 個 UI，最差對齊的期望
//    出現次數是 0.0122，也就是幾乎確定沒看到最差串擾，而眼圖看起來完全正常。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelPackage } from './ModelLibrary'
import RunHistory, { RestorableRun } from './RunHistory'
import EyeImageGallery from './EyeImageGallery'
import OpenFolderButton from './OpenFolderButton'
import ResultDetailsDrawer, { useResultDrawer } from './ResultDetailsDrawer'
import { LicenseTag, useLicenseBlock } from './LicenseTag'
import { releasedWithErrors, pickText, pickList, errorText } from '../backendFields'
import { useT } from '../i18n'
import type { Messages } from '../i18n'
import { confirmationState } from '../eyeWizard'
import SelectorFunnelPanel from './SelectorFunnelPanel'
import { selectorSignature } from '../selectorFunnelSelection'
import type { SelectorChange, SelectorInput } from '../selectorFunnelSelection'
type MultiLaneText = Messages['multiLane']

function failure(data: any, fallback: string, key = 'detail'): Error {
  return Object.assign(new Error(data?.[key] || fallback),
    { detail_en: data?.[`${key}_en`] })
}

interface PortBinding {
  port_index: number
  port: string
  side: number | null
  side_label?: string
  pin: string
  signal: string
  model: string
  evidence: 'high' | 'partial' | 'none'
  keys: string[]
  ambiguous?: number
  reason?: string
}

interface ComponentRank {
  component: string
  two_key_ports: number
  unique_signal_ports: number
  basis: string
}

interface Lane { label: string; ports: number[]; names: string[] }

interface Binding {
  /** `label_aliases`：同一側的其他寫法（元件編號 vs 料號），避免使用者
      以為工具漏掉了半份名稱。 */
  sides: { basis: string; labels: string[]; label_aliases?: string[][]; reason?: string }
  components: { selected: string; ranking: ComponentRank[] }[]
  lanes: Lane[]
  bindings: PortBinding[]
  evidence_counts: Record<string, number>
  requires_disposition: number[]
  requires_model: number[]
}

interface VariantChoice {
  selector: string
  direct_model?: string
  /** 這一輪扮演的角色。方向定案之後只有一欄用得到——寫入時去追究顆粒的
      驅動強度為什麼不是 48，那個值屬於控制器，問錯了對象。 */
  role: 'driver' | 'receiver' | 'unknown'
  side: number
  component: string
  drive_ohm: number | null
  odt_ohm: number | null
  tx: { selected: string; requires_user: boolean; reason: string
    candidates: string[]; rate_checked?: boolean }
  rx: { selected: string; requires_user: boolean; reason: string
    candidates: string[]; rate_checked?: boolean }
  variants: { name: string; description: string; odt_ohm: number | null
    drive_ohm: number | null; technology: string | null }[]
}

/** 由所選驅動器的 IBIS [Ramp] 導出的邊緣速率與頻寬。 */
interface EdgeBandwidth {
  rise_time_ps: number
  rise_time_source: 'given' | 'ibis_ramp' | 'rule_of_thumb'
  usable_bandwidth_ghz: number
  sweep_max_ghz: number
  basis: string
}

interface PendingDecision {
  field: string
  label: string
  why: string
  side?: number
  port?: string
  port_index?: number
  suggested?: string
}

/** 匯流排方向（ADR-0049）。`driving_side` 為 null 就是還沒定案，不能送解。 */
interface BusDirection {
  driving_side: number | null
  receiving_side: number | null
  basis: '' | 'model_type' | 'user'
  requires_user: boolean
  feasible: number[]
  reason: string
  sides: { side: number; label: string; model_types: string[]
    can_drive: boolean; can_receive: boolean; unbound_ports: string[] }[]
  /** 逐道判定：位元組通道會混著單向道（DM 由控制器單向驅動）與雙向道。 */
  lanes: { label: string; feasible: number[]; models: string[]; why: string }[]
  blocking_lanes: { side: number; lanes: string[] }[]
  feasible_without_blocking_lanes: number[]
}

interface Suggestion {
  analysis_kind: 'byte_lane' | 'multi_lane_crosstalk'
  group: { kind: string; strobe_pairs: { labels: string[]; pins: string[] }[]; why: string }
  bus_direction: BusDirection
  bus_direction_applies: boolean
  /** 由所選驅動器的 [Ramp] 導出。取不到模型時為 null。 */
  bandwidth: EdgeBandwidth | null
  lane_orientation: { label: string; input_port: string; output_port: string;
    input_index: number; output_index: number }[]
  touchstone: { path: string; n_ports: number; port_names: string[]; has_port_names: boolean; sha256?: string }
  binding: Binding
  packages: { side: number; package_id: string; display_name: string; component: string }[]
  two_package: boolean
  package_assignment: { swapped: boolean; basis: string; tie: boolean; scores: number[] }
  variant_choices: VariantChoice[]
  pending_decisions: PendingDecision[]
  quality: {
    executed: boolean
    blocked?: boolean
    intrinsic?: { passivity_max_singular_value: number; causality_precursor_energy_ratio: number | null
      causality_per_path: { path: number[]; ratio: number | null }[] }
    checks?: { check: string; label: string; value: number | null; limit: number
      status: 'pass' | 'fail' | 'unknown'; basis: string }[]
    warnings?: string[]
  }
  blockers: string[]
  warnings: string[]
  /** 後端 with_warning_fields 補的，與 warnings 同順序。 */
  warning_codes?: string[]
  ready: boolean
}

type Disposition = { kind: 'terminate' | 'open' | 'ground'; impedance_ohm?: number; reference_volt?: number }



/** 隨機碼型下最差對齊的期望出現次數。每條攻擊者要轉態且方向相反，各四分之一。 */
function worstCaseExpectation(laneCount: number, uiCount: number): number {
  return uiCount * Math.pow(0.25, Math.max(0, laneCount - 1))
}

interface ChannelJob {
  running?: boolean
  status?: string
  phase?: string
  message?: string
  error?: string
  job_id?: string
  started_at?: number | null
  finished_at?: number | null
  result?: any
}

/** 選單上要看得出這份模型能不能用。
 *
 * 2026-08-24 實測模型庫：ansys_ddr4_controller 與 ansys_ddr4_memory 的
 * DQ0／DQS± 在 .ibs 裡指向未定義的模型（IBIS Checker 明講），套件狀態是
 * `block`。選單只印名字的話，使用者會選下去，然後在綁定那一步才發現那幾支
 * 腳配不到模型——而那時已經走了三個步驟。
 */
/** 這一側根本用不了的原因；能用回空字串。
 *
 * 2026-08-28 掃描 209 個客戶模型：第二層 86% 的失敗集中在配對——單角色模型
 * （只有 Tx 或只有 Rx）被選到不該去的那一側，跑到求解才爆。判定材料全在
 * manifest 裡，所以在選單上**當場**擋掉，而不是讓人走完流程才知道。
 */
function sideBlocker(item: ModelPackage, side: 'tx' | 'rx', m: MultiLaneText): string {
  const caps = item.capabilities
  if (!caps) return ''
  if (side === 'tx' && caps.tx_models === 0) return m.noDriver
  if (side === 'rx' && caps.rx_models === 0) return m.noReceiver
  return ''
}

function packageLabel(item: ModelPackage, side: 'tx' | 'rx', m: MultiLaneText): string {
  const blocker = sideBlocker(item, side, m)
  if (blocker) return `${item.display_name}${m.paren(blocker)}`
  const status = item.compatibility?.status
  if (status === 'block') return `${item.display_name}${m.paren(m.hasErrors)}`
  if (status === 'warning') return `${item.display_name}${m.paren(m.hasWarnings)}`
  return item.display_name
}


export interface MultiLaneWizardProps {
  packages: ModelPackage[]
  onLibraryChanged?: () => void | Promise<void>
  /** 通道與速率由精靈第 1、2 步提供；`null` 是使用者還沒填，不代用任何預設值。 */
  touchstonePath: string
  dataRateGbps: number | null
  /** 執行歷史「回到這一版設定」時把通道／速率填回精靈。 */
  onTouchstoneChange?: (path: string) => void
  onDataRateChange?: (rate: number) => void
  /** 精靈目前在第幾步；只顯示屬於這一步的區塊。 */
  wizardStep: number
  /** 上層精靈的規範與覆寫紀錄；與本元件的變體依據一起保存。 */
  presetSelectionBasis?: Record<string, unknown> | null
}

export default function MultiLaneWizard({
  packages, onLibraryChanged, touchstonePath, dataRateGbps,
  onTouchstoneChange, onDataRateChange, wizardStep, presetSelectionBasis,
}: MultiLaneWizardProps) {
  const { t, lang } = useT()
  const m = t.multiLane
  const hiddenStep = (step: number) => wizardStep !== step
  const touchstone = touchstonePath
  const setTouchstone = (path: string) => onTouchstoneChange?.(path)
  const [packageId, setPackageId] = useState('')
  // 另一側的模型套件。DDR 的兩端永遠是控制器與顆粒兩家料號，只給一份會讓
  // 對側綁到同一顆模型——綁得上、是 high 證據、眼圖照畫，只是型號整組是反的。
  const [rxPackageId, setRxPackageId] = useState('')
  // 精靈的空速率仍是待填，不代用任何預設值。
  const dataRate = dataRateGbps ?? 0
  const setDataRate = (rate: number) => onDataRateChange?.(rate)
  /** Port 索引 → 使用者指定的緩衝器（`[Model Selector]` 或模型名稱）。 */
  const [portModels, setPortModels] = useState<Record<number, string>>({})
  // 上升時間只影響**預檢**（拐點 0.5/Tr 決定 S 參數頻寬夠不夠、也決定
  // 該用 SIwave 還是 HFSS）。它**不是**餵給緩衝器的邊緣——真正的邊緣由
  // IBIS 的 V-T 表決定。留空＝由所選模型的 [Ramp] 自動導出。
  const [riseTimePs, setRiseTimePs] = useState<string>('')
  const [patternKind, setPatternKind] = useState<'worst_case' | 'prbs'>('worst_case')
  /**
   * 串擾與時序各跑一次。
   *
   * 兩種碼型回答的是不同的問題而且不可互換：最差碼型刻意讓受害道長時間
   * 持平，選通邊看到的資料是靜止的，**量不到任何時序約束**；PRBS 反過來，
   * 量得到時序但幾乎確定沒看到最差串擾。一份完整的報告兩個都要，而使用者
   * 不該需要知道「要按兩次」——不知道的人拿最差碼型跑完會看到一整排空值。
   */
  const [bothPatterns, setBothPatterns] = useState(false)
  const [transientUi, setTransientUi] = useState(2000)
  const [settleUi, setSettleUi] = useState(4)
  // ── DDR 時序（只有組內有選通參考時才有意義；ADR-0044）────────────
  //
  // 沒有選通就沒有時序裕度這個量，所以這一段的預設是「跟著選通走」：
  // 偵測到選通對就打開，偵測不到就整段隱藏，不讓人填一組不會被用到的數字。
  const [measureTiming, setMeasureTiming] = useState(true)
  //: 選通相對資料的相位。DDR 寫入時控制器把 DQS 對齊在資料眼中央 = 半個 UI。
  //  填 0 的話 DQ 與 DQS 的轉態重疊，量到的 Setup／Hold 會趨近於零。
  // 方向：寫入＝控制器推、讀取＝顆粒推。選通相位由它決定（寫 0.5 UI、
  // 讀 0），使用者不必也不該自己填那個數字——它是 DDR 的定義。
  const [busMode, setBusMode] = useState<'write' | 'read'>('write')
  const [bothDirections, setBothDirections] = useState(false)
  const strobePhaseUi = busMode === 'write' ? 0.5 : 0
  // 判讀準位用 JEDEC 的講法輸入（VDDQ 與相對 Vref 的偏移），四個門檻由此導出，
  // 不要求使用者自己算四個絕對電壓。
  const [vddq, setVddq] = useState('1.35')
  const [acOffset, setAcOffset] = useState('0.130')
  const [dcOffset, setDcOffset] = useState('0.090')
  // 規格要求。留空就不換算成裕度、也不判 Pass／Fail（ADR-0015）。
  const [tds, setTds] = useState('')
  const [tdh, setTdh] = useState('')
  /**
   * DDR4 以後資料群的 Rx 遮罩：寬幾個 UI、高幾毫伏。
   *
   * DDR3 是 setup／hold ＋ derating ＋ 準位；**DDR4 的資料群換了一整套**，
   * 改成「眼圖要容納一個遮罩」，slew rate derating 與抖動都含在遮罩裡。
   * 做 DDR4 案子只量 setup／hold 是不夠的——量的不是同一件事。
   */
  const [maskUi, setMaskUi] = useState('')
  const [maskMv, setMaskMv] = useState('')
  /**
   * JEDEC 的 derating 表，貼 JSON 進來。
   *
   * 為什麼是貼的不是一格一格填：那種表有十幾二十列，而且 tDS 與 tDH 各一張。
   * 做成表單只會讓人不想填，然後就用了 base 值——**而 base 值假設某個邊緣
   * 斜率，邊緣較慢時要求會變嚴，等於高估裕度**。
   */
  const [deratingText, setDeratingText] = useState('')
  const [corners, setCorners] = useState<string[]>(['typ', 'min', 'max'])
  // 分析狀態就顯示在這一頁。先前它只在「標準 IBIS 通道」頁，那一頁移掉之後
  // 多埠分析會變成「按下去就沒有下文」。
  const [job, setJob] = useState<ChannelJob | null>(null)
  /** 這個面板自己送出的工作（#0088）：精靈與其他面板共用同一份工作狀態，
   *  不過濾的話別人的結果會出現在這裡。 */
  const ownJobIds = useRef(new Set<string>())
  const own = (id?: string) => { if (id) ownJobIds.current.add(String(id)) }
  const [laneCount, setLaneCount] = useState<number | null>(null)
  // 方向沒有預設值：雙向 I/O 的讀與寫都真實存在，替使用者選一個等於
  // 有一半的機率量到反方向的通道，而且沒有任何跡象（ADR-0049）。
  const [drivingSide, setDrivingSide] = useState<number | null>(null)
  const [dispositions, setDispositions] = useState<Record<number, Disposition>>({})
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [confirmedSignature, setConfirmedSignature] = useState<string | null>(null)
  const [selectorDecisions, setSelectorDecisions] = useState<Record<string, SelectorChange>>({})
  const [selectorAnswers, setSelectorAnswers] = useState<Record<string,
    { odtOhm: number | null; driveOhm: number | null }>>({})
  const [busy, setBusy] = useState(false)
  // 會用到 Ansys 的按鈕（ADR-0062）：沒有空位就變灰並寫原因。
  const quickCheckBlock = useLicenseBlock(['model_check'])
  const multiLaneBlock = useLicenseBlock(['multi_lane'])
  const [error, setError] = useState('')
  const [started, setStarted] = useState('')
  /** 快速檢驗的參考通道檔位（2026-08-29 下午）。 */
  const [lossyReference, setLossyReference] = useState(false)
  // ── 位址命令群（乙7 介面，2026-08-29）──────────────────────────
  // fly-by：控制器推一條線、線上掛著多顆顆粒。電路層早就支援
  // 一對多（共用驅動埠的道共用驅動器），缺的是走得到的介面。
  const [addrDriver, setAddrDriver] = useState('')
  const [addrReceivers, setAddrReceivers] = useState('')
  const [addrCmdRate, setAddrCmdRate] = useState<'1T' | '2T'>('1T')
  const [addrCheck, setAddrCheck] = useState<{ signature: string; data: any } | null>(null)
  const [addrBusy, setAddrBusy] = useState(false)
  const [addrError, setAddrError] = useState('')
  const addrSignature = JSON.stringify([touchstone, addrDriver, addrReceivers, addrCmdRate, dataRate])
  const currentAddrSignature = useRef(addrSignature)
  currentAddrSignature.current = addrSignature
  const addrSeq = useRef(0)
  const pendingAddr = useRef<{ seq: number; signature: string } | null>(null)
  const addrResult = addrCheck?.signature === addrSignature ? addrCheck.data : null
  useEffect(() => {
    setAddrCheck(null); setAddrError('')
    if (pendingAddr.current && pendingAddr.current.signature !== addrSignature) {
      addrSeq.current += 1
      pendingAddr.current = null
      setAddrBusy(false)
    }
  }, [addrSignature])
  /** 快速檢驗（近無損直連）這一輪的 job 與實際用到的兩顆模型。
   *  結果沿用同一個 /api/ibis-channel/status，靠 job_id 認出它是基準眼圖。 */
  const [quickCheck, setQuickCheck] = useState<
    { jobId: string; txModel: string; rxModel: string } | null>(null)

  const suggestSeq = useRef(0)
  const pendingSuggest = useRef<{ seq: number; signature: string } | null>(null)
  const suggestSignature = (side = drivingSide) => JSON.stringify([
    touchstone, packageId, rxPackageId, dataRate, side,
    portModels, riseTimePs, patternKind, transientUi,
  ])
  const currentSuggestSignature = useRef('')
  currentSuggestSignature.current = suggestSignature()
  // 父精靈改速率、或使用者改選型時，未完成的舊預檢不得恢復原接線。
  useEffect(() => {
    const pending = pendingSuggest.current
    if (pending && pending.signature !== currentSuggestSignature.current) {
      suggestSeq.current += 1
      pendingSuggest.current = null
      setBusy(false)
    }
    setSuggestion(null)
  }, [touchstone, packageId, rxPackageId, dataRate, drivingSide,
    portModels, riseTimePs, patternKind, transientUi])

  const ibisPackages = useMemo(
    () => packages.filter(item => item.kind === 'ibis'), [packages])
  // 被這一頁排除掉的套件。有幾個、為什麼看不到，要說出來。
  const amiPackages = useMemo(
    () => packages.filter(item => item.kind !== 'ibis'), [packages])

  const lanes = suggestion?.binding.lanes ?? []
  const selectedLanes = laneCount === null ? lanes.length : Math.min(laneCount, lanes.length)
  const usedPorts = useMemo(() => {
    const used = new Set<number>()
    lanes.slice(0, selectedLanes).forEach(lane => lane.ports.forEach(port => used.add(port)))
    return used
  }, [lanes, selectedLanes])

  /**
   * 成道了、另一端也綁到模型了，就只有這一端綁不到——那代表**模型檔裡
   * 真的沒有那根腳**，不是我們比對不到。實測 Ansys 教材那組通用模型連
   * 一根 DM 腳位都沒有；他們自己的 DDR Wizard 是靠「Net Group」指派模型
   * 繞過去的。這裡就是那個指派。
   */
  const portsNeedingModel = useMemo(() => {
    if (!suggestion) return []
    return (suggestion.binding.requires_model || []).map(index => ({
      index, name: suggestion.touchstone.port_names[index] ?? `Port ${index + 1}`,
    }))
  }, [suggestion])

  /** 可以指定的緩衝器：這一側 `[Model Selector]` 與它底下的變體。 */
  const bufferChoices = useMemo(() => {
    if (!suggestion) return []
    const names = new Set<string>()
    suggestion.variant_choices.forEach(choice => {
      names.add(choice.selector)
      choice.variants.forEach(variant => names.add(variant.name))
    })
    return Array.from(names).sort()
  }, [suggestion])

  /** `sideOverride` 讓方向下拉一改就重新推導，不必等 setState 生效。 */
  async function runSuggest(sideOverride?: number | null) {
    const side = sideOverride === undefined ? drivingSide : sideOverride
    const seq = ++suggestSeq.current
    const signature = suggestSignature(side)
    pendingSuggest.current = { seq, signature }
    const current = () => seq === suggestSeq.current
      && signature === currentSuggestSignature.current
    setBusy(true); setError(''); setSuggestion(null); setStarted('')
    try {
      const body: Record<string, unknown> = {
        touchstone_path: touchstone, package_id: packageId,
        data_rate_gbps: dataRate, exploratory: true,
      }
      if (rxPackageId) body.rx_package_id = rxPackageId
      if (side !== null) body.driving_side = side
      // 模型檔裡沒有那根腳的 Port，由使用者指定用哪顆緩衝器——等同
      // Ansys DDR Wizard 的「Net Group」指派。不給的話 DM 只剩「終結掉」
      // 一個選項，而終結一條真實的訊號路徑會低估串擾。
      if (Object.keys(portModels).length) body.port_models = portModels
      // 上升時間留空時後端會從 [Ramp] 導；但預檢的頻寬檢查需要一個值，
      // 沒有就先用 0.2×UI 的通則帶進去，並在畫面上說明它是通則。
      body.rise_time_ps = riseTimePs ? Number(riseTimePs) : 200 / dataRate
      body.unit_interval_ps = 1000 / dataRate
      body.bit_count = patternKind === 'worst_case' ? 128 : transientUi
      const response = await fetch('/api/multi-lane/suggest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await response.json()
      if (!current()) return
      if (!response.ok) throw failure(data,  m.suggestFailed)
      setSuggestion(data as Suggestion)
      setLaneCount(null)
      setDispositions({})
      // portModels 不清：那是使用者填的，清掉等於每次重新預檢都要再填一次。
    } catch (exc) {
      if (current()) setError(errorText(exc, lang))
    } finally {
      if (current()) { pendingSuggest.current = null; setBusy(false) }
    }
  }

  /** 反方向沒有驅動器的道。DDR 的 DM 是單向的，讀取方向會少這一條。 */
  const reverseOnlyDropped = useMemo(() => {
    const receivingSide = suggestion?.bus_direction.receiving_side
    if (!suggestion || receivingSide === null || receivingSide === undefined) return []
    return suggestion.binding.lanes.slice(0, selectedLanes)
      .filter(lane => !(suggestion.bus_direction.lanes
        .find(item => item.label === lane.label)?.feasible ?? [0, 1])
        .includes(receivingSide))
      .map(lane => lane.label)
  }, [suggestion, selectedLanes])

  /**
   * 反方向丟掉的那幾條道，它們的 Port 在那個方向就變成沒人用——必須有處置。
   * 「哪些 Port 沒被用到」是**隨方向變的**：DDR 的 DM 寫入時是一條道，
   * 讀取時顆粒端沒有 DM 的驅動器。少了這一步，反方向會以
   * 「這些 Port 沒有接上緩衝器也沒有指定處置」中止，而畫面上無處可填。
   */
  const reverseDroppedPorts = useMemo(() => {
    if (!suggestion || !bothDirections || !reverseOnlyDropped.length) return []
    const dropped = new Set(reverseOnlyDropped)
    return suggestion.binding.lanes
      .filter(lane => dropped.has(lane.label))
      .flatMap(lane => lane.ports)
  }, [suggestion, bothDirections, reverseOnlyDropped])

  const portsNeedingDisposition = useMemo(() => {
    if (!suggestion) return []
    const needed = new Set(reverseDroppedPorts)
    return suggestion.touchstone.port_names
      .map((name, index) => ({ name, index }))
      .filter(item => !usedPorts.has(item.index) || needed.has(item.index))
  }, [suggestion, usedPorts, reverseDroppedPorts])

  const strobePair = suggestion?.group.strobe_pairs?.[0]
  // 兩側都是顆粒（#0099）：顯示後端那句，中英文由代碼表給，這裡只加標題。
  const bothDramIndex = suggestion?.warning_codes?.indexOf('multilane.both_sides_dram') ?? -1
  const bothDramWarning = suggestion && bothDramIndex >= 0
    ? pickList(suggestion, 'warnings', lang)[bothDramIndex] : ''
  const vref = Number(vddq) / 2
  const thresholds = {
    vih_ac: vref + Number(acOffset), vil_ac: vref - Number(acOffset),
    vih_dc: vref + Number(dcOffset), vil_dc: vref - Number(dcOffset),
    vddq: Number(vddq),
  }
  const thresholdsValid = Object.values(thresholds).every(v => Number.isFinite(v))

  /** 解析貼上的 derating 表；解不開就回錯誤訊息，不會靜默忽略。 */
  const derating = useMemo(() => {
    const text = deratingText.trim()
    if (!text) return { table: null as unknown, error: '' }
    try {
      const parsed = JSON.parse(text)
      const keys = Object.keys(parsed)
      const allowed = ['tds_ps', 'tdh_ps', 'tis_ps', 'tih_ps']
      const bad = keys.filter(k => !allowed.includes(k))
      if (bad.length) return { table: null, error: m.deratingUnknownKeys(bad.join(m.listSep)) }
      for (const key of keys) {
        const rows = parsed[key]
        if (!Array.isArray(rows)) return { table: null, error: m.deratingNotArray(key) }
        for (const row of rows) {
          if (typeof row?.slew_v_per_ns !== 'number'
            || typeof row?.adjust_ps !== 'number') {
            return { table: null, error: m.deratingRowFields(key) }
          }
        }
      }
      return { table: parsed, error: '' }
    } catch (exc) {
      return { table: null, error: errorText(exc, lang) }
    }
  }, [deratingText, m])

  /** 時序相關的送出欄位。沒有選通、或使用者關掉，就一個都不送。 */
  function timingPayload(): Record<string, unknown> {
    if (!measureTiming || !strobePair) return {}
    const payload: Record<string, unknown> = {
      strobe_labels: strobePair.labels,
      strobe_phase_ui: strobePhaseUi,
    }
    if (thresholdsValid) payload.timing_thresholds = thresholds
    // tDS／tDH 兩個都填了才送設定檔：只填一個換算得出一半的裕度，
    // 另一半會顯示成「缺指標」，比不判定更容易誤讀。
    if (tds && tdh) {
      payload.compliance_profile = {
        schema_version: 1,
        name: m.userProfileName,
        version: 'user',
        applicability: `${dataRate} Gbps`,
        source: m.userProfileSource,
        limits: { setup_margin_ps: 0, hold_margin_ps: 0 },
        requirements: {
          tds_ps: Number(tds), tdh_ps: Number(tdh),
          // 兩個都填了才送遮罩：只填一個量不出任何東西。
          ...(maskUi && maskMv
            ? { mask_ui: Number(maskUi), mask_mv: Number(maskMv) } : {}),
        },
        // 有表就一起送。後端逐個選通邊各自查表再取最小——先取最小時間
        // 再套一個 derating 值會漏掉真正的最差邊。
        ...(derating.table ? { derating: derating.table } : {}),
      }
    }
    return payload
  }

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const state = await fetch('/api/ibis-channel/status').then(r => r.json())
        if (alive) setJob(state)
      } catch { /* 輪詢失敗不必打斷畫面 */ }
    }
    void tick()
    const timer = setInterval(tick, 2000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  /**
   * 換了通道或任一側的模型，就把預檢結果**與已定案的驅動側**一起清掉。
   *
   * 只清 `suggestion` 是不夠的：`drivingSide` 留著會讓下一次預檢把上一片板子
   * 選的方向送出去，後端收到就當成「依指定」，於是新檔案的方向是使用者從來
   * 沒替它選過的（ADR-0049）。
   */
  useEffect(() => {
    setSuggestion(null); setDrivingSide(null); setStarted('')
  }, [touchstone, packageId, rxPackageId, dataRate])

  /** 就地匯入 IBIS：瀏覽、匯入、重新整理，然後把新模型直接選起來。
   *
   *  為什麼不要求先去「模型庫」分頁：`.ibs` 常常散在客戶資料夾深處，
   *  而使用者是在這一頁才發現下拉是空的。把人趕去另一頁再走回來，
   *  中間還要自己記得剛匯入的是哪一個——那是三步變六步。
   */
  async function importIbis(target: 'tx' | 'rx') {
    setBusy(true); setError('')
    try {
      const picked = await fetch('/api/models/browse').then(r => r.json())
      const paths: string[] = picked?.paths?.length ? picked.paths
        : (picked?.path ? [picked.path] : [])
      if (!paths.length) return          // 使用者按了取消，不是錯誤
      let lastId = ''
      for (const path of paths) {
        const response = await fetch('/api/models/import', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        })
        const data = await response.json()
        if (!response.ok) throw failure(data,  m.importFailed(path))
        lastId = data?.model?.package_id || lastId
      }
      await onLibraryChanged?.()
      if (lastId) (target === 'tx' ? setPackageId : setRxPackageId)(lastId)
    } catch (exc) {
      setError(errorText(exc, lang))
    } finally { setBusy(false) }
  }

  /** 快速檢驗：TX 與 RX 背對背接近無損參考通道，先看基準眼圖。
   *
   *  不需要 Touchstone——它回答的是「這對模型本來給多大的眼」。之後接上
   *  真實通道，看到的劣化才有歸因：基準眼就不好＝模型或資料率的問題；
   *  基準眼好、真通道壞＝通道的問題。模型由套件角色自動挑，零新設定。 */
  async function runQuickCheck() {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/ibis-channel/quick-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_package_id: packageId,
          rx_package_id: rxPackageId || packageId,
          data_rate_gbps: dataRate,
          reference: lossyReference ? 'lossy' : 'lossless',
        }),
      })
      const data = await response.json()
      if (!response.ok) throw failure(data,  m.quickCheckFailed)
      own(data.job_id)
      setQuickCheck({
        jobId: data.job_id || '',
        txModel: data.quick_check?.tx_model || '',
        rxModel: data.quick_check?.rx_model || '',
      })
    } catch (exc) {
      setError(errorText(exc, lang))
    } finally { setBusy(false) }
  }

  /** 位址命令群：把埠名攤成 fly-by 的道（乙7）。 */
  async function analyzeAddressGroup() {
    const seq = ++addrSeq.current
    const signature = addrSignature
    pendingAddr.current = { seq, signature }
    const current = () => seq === addrSeq.current && signature === currentAddrSignature.current
    setAddrBusy(true); setAddrError(''); setAddrCheck(null)
    try {
      const response = await fetch('/api/address-command/lanes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touchstone_path: touchstone,
          driver_component: addrDriver.trim(),
          receiver_components: addrReceivers.split(/[\uFF0C,]/)
            .map(item => item.trim()).filter(Boolean),
          data_rate_gbps: dataRate,
          command_rate: addrCmdRate,
        }),
      })
      const data = await response.json()
      if (!current()) return
      if (!response.ok) throw failure(data,  m.groupFailed)
      if (data.reason) throw failure(data, '', 'reason')
      setAddrCheck({ signature, data })
    } catch (exc) {
      if (current()) setAddrError(errorText(exc, lang))
    } finally {
      if (current()) { pendingAddr.current = null; setAddrBusy(false) }
    }
  }

  /** 以指定顆粒的 CK 對為時間基準啟動位址群分析。
   *  電路裡留著**全部**接收端（fly-by 的負載就是那幾顆），只換 strobe。 */
  async function startAddressRun(device: string) {
    if (!suggestion || !addrResult) return
    if (addrCheck?.signature !== currentAddrSignature.current) return
    if (confirmation !== 'confirmed') return
    if (addrBusy || variantPending || Boolean(job?.running) || Boolean(multiLaneBlock)) return
    if (directionPending) {
      setAddrError(m.directionNotSet)
      return
    }
    setAddrBusy(true); setAddrError(''); setStarted('')
    try {
      const entry = (addrResult.devices || [])
        .find((item: any) => item.device === device)
      const widestOf = (role: VariantChoice['role']) =>
        suggestion.variant_choices
          .filter(item => item.role === role && pickedVariant(item))[0]
      const driverChoice = widestOf('driver')
      const receiverChoice = widestOf('receiver')
      const response = await fetch('/api/multi-lane/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touchstone_path: touchstone,
          package_id: packageId, rx_package_id: rxPackageId,
          selection_basis: selectionBasis,
          lanes: addrResult.lanes,
          // 位址群就是 fly-by（一驅動多接收）。分組端點已經這樣標了，
          // 照原樣送過去；讓後端去猜拓樸，只要有一顆顆粒沒被歸進來，
          // 扇出就看起來像點對點，分支延遲整組不會被算進去。
          ...(addrResult.topology ? { topology: addrResult.topology } : {}),
          // 方向未定時**不送這個欄位**：送 0 會被後端當成「使用者指定第 1 側」，
          // 於是雙向 I/O 有一半機率整場量到反方向而且毫無跡象（ADR-0049）。
          ...(suggestion.bus_direction.driving_side !== null
            ? { driving_side: suggestion.bus_direction.driving_side } : {}),
          tx_buffer: driverChoice ? pickedVariant(driverChoice) : '',
          rx_buffer: receiverChoice ? pickedVariant(receiverChoice) : '',
          dispositions: Object.entries(dispositions).map(([index, plan]) => ({
            port_index: Number(index), ...plan,
          })),
          data_rate_gbps: dataRate,
          // 位址時序要看轉態，最差碼型會讓道長時間持平——量不到約束。
          pattern_kind: 'prbs',
          settle_ui: settleUi, transient_ui_count: transientUi,
          strobe_labels: entry?.strobe_labels || [],
          // CK 不像 DQS 有寫入位移——CA 對 CK 的對齊正是要量的東西。
          strobe_phase_ui: 0,
          ...(thresholdsValid ? { timing_thresholds: thresholds } : {}),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw failure(data,  m.startFailed)
      own(data.job_id); setStarted(m.addrQueued(data.job_id ?? '—', device))
    } catch (exc) {
      setAddrError(errorText(exc, lang))
    } finally { setAddrBusy(false) }
  }

  async function start(sweep = false) {
    if (!suggestion) return
    if (!canStart || Boolean(multiLaneBlock) || (sweep && corners.length === 0)) return
    setBusy(true); setError(''); setStarted('')
    try {
      // 驅動器取自**驅動側**的選擇器、接收器取自接收側，不能兩個都拿
      // 第一個選擇器——兩側料號不同時那會把顆粒的模型當成控制器的驅動器。
      // 一次求解只有一組 tx／rx 緩衝器，所有道共用。所以要挑**涵蓋最多埠**
      // 的那個選擇器，不是清單裡的第一個——第一個按字母排是 `DM`，
      // 拿資料遮罩的緩衝器去跑八條 DQ，跑得動而且不會報錯。
      const portsPerSelector: Record<string, number> = {}
      suggestion.binding.bindings.forEach(row => {
        if (row.model) portsPerSelector[row.model] =
          (portsPerSelector[row.model] || 0) + 1
      })
      const widest = (role: VariantChoice['role']) =>
        suggestion.variant_choices
          .filter(item => item.role === role && pickedVariant(item))
          .sort((a, b) => (portsPerSelector[b.selector] || 0)
            - (portsPerSelector[a.selector] || 0))[0]
      const driver = widest('driver')
      const receiver = widest('receiver')

      /**
       * 每條道自己的緩衝器。
       *
       * 一條道的兩個 Port 各自綁到一個 `[Model Selector]`（DQ 綁
       * `*_dq`、選通綁 `*_dqs`），而變體選擇是**逐（側, 選擇器）**的。
       * 把整組道都套上同一顆是不對的：DQ 與 DQS 常常有各自的驅動強度與
       * ODT。Ansys 那組通用模型剛好兩者的 `[Ramp]` 完全一樣，所以看不出
       * 問題，但真實廠商模型不會這麼巧。
       *
       * 找不到對應的選擇器就留空——後端會沿用共用的那一組，不會失敗。
       */
      const variantFor = (portIndex: number | undefined,
        role: VariantChoice['role'], targetRole = role): string => {
        if (portIndex === undefined) return ''
        const row = suggestion.binding.bindings[portIndex]
        if (!row?.model) return ''
        const match = suggestion.variant_choices.find(
          item => item.selector === row.model && item.role === role)
        return match ? pickedVariant(match, targetRole) : ''
      }
      const choice = {
        tx: { selected: driver ? pickedVariant(driver) : '' },
        rx: { selected: receiver ? pickedVariant(receiver) : '' },
      }
      // 反方向：驅動器與接收器對調，每條道的輸入輸出埠也跟著對調，而且
      // **反方向沒有驅動器的道要拿掉**。DDR 的 DM 是單向的（只有寫入時
      // 控制器會推），讀取方向顆粒端根本沒有 DM 的驅動器——那不是錯誤，
      // 是 DDR 本來就這樣。不拿掉的話整個反方向會被擋下來。
      const reverseLanes = driver && receiver
        ? lanes.slice(0, selectedLanes)
          .map((lane, index) => ({ lane, index }))
          .filter(({ lane }) => (suggestion.bus_direction.lanes
            .find(item => item.label === lane.label)?.feasible ?? [0, 1])
            .includes(receiver.side))
          .map(({ lane, index }) => {
            const oriented = suggestion.lane_orientation[index]
            return {
              label: lane.label,
              input_port: oriented?.output_port ?? lane.names[1],
              output_port: oriented?.input_port ?? lane.names[0],
              // 反方向：驅動器與接收器對調，所以角色也要跟著對調。
              tx_buffer: variantFor(oriented?.output_index, 'receiver', 'driver'),
              rx_buffer: variantFor(oriented?.input_index, 'driver', 'receiver'),
            }
          })
        : []
      const reverse = driver && receiver && reverseLanes.length ? {
        mode: busMode === 'write' ? 'read' : 'write',
        driving_side: receiver.side,
        tx_buffer: pickedVariant(receiver, 'driver'),
        rx_buffer: pickedVariant(driver, 'receiver'),
        lanes: reverseLanes,
        // 整組都送過去，遠端會把「這個方向由緩衝器驅動」的那幾個忽略掉。
        // 不能只送共用的那組：反方向少跑的道，它們的 Port 在這個方向沒人用。
        dispositions: Object.entries(dispositions).map(([index, plan]) => ({
          port_index: Number(index), ...plan,
        })),
      } : null
      const response = await fetch(
        sweep ? '/api/multi-lane/sweep' : '/api/multi-lane/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          touchstone_path: touchstone, package_id: packageId,
          rx_package_id: rxPackageId,
          selection_basis: selectionBasis,
          // 依定案的方向送出。遠端會再強制一次（ADR-0049），這裡送對的是
          // 為了讓畫面上顯示的方向與送出的內容一致。
          lanes: lanes.slice(0, selectedLanes).map((lane, index) => {
            const oriented = suggestion.lane_orientation[index]
            return {
              label: lane.label,
              input_port: oriented?.input_port ?? lane.names[0],
              output_port: oriented?.output_port ?? lane.names[1],
              // 這一條道自己的緩衝器；留空時後端沿用共用的那一組。
              tx_buffer: variantFor(oriented?.input_index, 'driver'),
              rx_buffer: variantFor(oriented?.output_index, 'receiver'),
            }
          }),
          driving_side: suggestion.bus_direction.driving_side,
          tx_buffer: choice?.tx.selected, rx_buffer: choice?.rx.selected,
          // 沒填處置的 Port **不補預設**：默默選開路正是 ADR-0046 要禁的事。
          // 填不完整時 `canStart` 已經擋住啟動，這裡不留第二條路。
          dispositions: portsNeedingDisposition
            .filter(item => dispositions[item.index])
            .map(item => ({ port_index: item.index, ...dispositions[item.index] })),
          data_rate_gbps: dataRate, pattern_kind: patternKind,
          // 兩種都跑時把清單送過去；後端會逐種各自展開 Corner 與方向，
          // 並且**分開排名**——最差碼型量不到時序，混在一起排沒有意義。
          ...(sweep && bothPatterns
            ? { pattern_kinds: ['worst_case', 'prbs'] } : {}),
          settle_ui: settleUi, transient_ui_count: transientUi,
          bus_mode: busMode,
          ...timingPayload(),
          ...(sweep ? { corners } : {}),
          // 讀與寫在同一次設定裡跑完（Ansys DDR Wizard 也是一次產生兩張
          // 電路圖）。反方向的驅動器、接收器與道向都會跟著換。
          ...(sweep && bothDirections && reverse ? {
            directions: [
              { mode: busMode, driving_side: suggestion.bus_direction.driving_side,
                tx_buffer: choice?.tx?.selected, rx_buffer: choice?.rx?.selected },
              reverse,
            ],
          } : {}),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw failure(data,  m.startFailed)
      // 勾了雙向就是「方向 × Corner」。只印 Corner 數會與進度列的 [1/6]
      // 對不上——畫面上兩個數字互相矛盾時，看的人只會不信任兩個。
      const passes = corners.length * (sweep && bothDirections && reverse ? 2 : 1)
      own(data.job_id); setStarted(m.queued(data.job_id ?? '—')
        + (sweep ? m.sweepPlan(passes, corners.length, passes > corners.length) : '')
        + m.progressBelow)
    } catch (exc) {
      setError(errorText(exc, lang))
    } finally { setBusy(false) }
  }

  const shownJob = job && ownJobIds.current.has(String(job.job_id || '')) ? job : null
  const jobElapsed = shownJob?.started_at
    ? Math.max(0, Math.round(((shownJob.finished_at || Date.now() / 1000) - shownJob.started_at)))
    : 0
  const jobResult = shownJob?.status === 'done' ? shownJob?.result : null
  const details = useResultDrawer(shownJob?.job_id)
  const ranking = jobResult?.ranking || null
  const signalTables: any[] = jobResult?.sweep
    ? (jobResult.tables || [])
    : (jobResult?.signal_table ? [jobResult.signal_table] : [])
  const timingWhy = jobResult?.sweep
    ? pickText(jobResult.runs?.[0]?.result?.timing, 'why', lang)
    : pickText(jobResult?.timing, 'why', lang)
  const fmtPs = (value: unknown) =>
    typeof value === 'number' ? value.toFixed(1) : '—'
  /** 目前顯示的結果是不是快速檢驗那一輪（近無損直連基準）。 */
  const isQuickCheck = Boolean(quickCheck && job?.job_id === quickCheck.jobId)
  /** 快速檢驗的眼圖量測（眼高、眼寬…）；點對點結果的第一條 Lane。 */
  const quickMeasurements = isQuickCheck
    ? jobResult?.results?.[0]?.lanes?.[0]?.measurements ?? null
    : null
  /** 眼圖卡片。掃描時每個 Corner 各一組，單次執行就一組。 */
  const eyeCards = useMemo(() => {
    if (!jobResult) return []
    // 三種結果形狀（與後端 resolve_standard_ibis_result_image 對齊）：
    //   Corner 掃描   runs[i].result.lanes、點對點 results[i].lanes（快速檢驗
    //   走這一種）、多道單次 lanes。少了中間那種，快速檢驗只會有狀態沒有圖。
    const groups: { lanes: any[]; corner: string }[] = jobResult.sweep
      ? (jobResult.runs || []).map((run: any) => ({
        lanes: run?.result?.lanes || [], corner: pickText(run, 'label', lang) }))
      : jobResult.results
        ? (jobResult.results || []).map((res: any) => ({
          lanes: res?.lanes || [], corner: '' }))
        : [{ lanes: jobResult.lanes || [], corner: '' }]
    const cards: { key: string; title: string; corner: string; imageUrl: string }[] = []
    groups.forEach((group, analysisIndex) => {
      group.lanes.forEach((lane: any, laneIndex: number) => {
        // 第 0 張是波形、第 1 張才是眼圖（export_multi_lane_eyes 的順序）。
        const imageIndex = (lane.image_paths || []).length > 1 ? 1 : 0
        cards.push({
          key: `${analysisIndex}-${laneIndex}`,
          title: isQuickCheck ? m.baselineEye
            : lane.label || `Lane ${laneIndex + 1}`,
          corner: isQuickCheck && quickCheck
            ? `${quickCheck.txModel} → ${quickCheck.rxModel}` : group.corner,
          imageUrl: `/api/ibis-channel/image?analysis_index=${analysisIndex}`
            + `&lane_index=${laneIndex}&image_index=${imageIndex}`
            + `&job_id=${encodeURIComponent(String(shownJob?.job_id || ''))}`,
        })
      })
    })
    return cards
  }, [jobResult, isQuickCheck, quickCheck, m, lang])

  const missingDisposition = portsNeedingDisposition.filter(item => {
    const plan = dispositions[item.index]
    if (!plan) return true
    if (plan.kind !== 'terminate') return false
    return plan.impedance_ohm === undefined || plan.reference_volt === undefined
  })
  /**
   * 人工覆寫的鍵要含**側**。兩份 `.ibs` 出自同一個系列時選擇器會同名
   * （Ansys 的控制器與顆粒兩邊都叫 `ansys_ddr4_dq`），只用名稱當鍵的話
   * 改控制器那一欄會連顆粒那一欄一起改掉，而畫面上兩欄都顯示成你選的值。
   */
  const variantKey = (item: VariantChoice) => `${item.side}:${item.selector}:${item.role}`
  // 反向求解須重新依角色選型：正向的接收端 ODT 不能直接拿去當驅動端。
  const reversePorts = new Set(lanes.slice(0, selectedLanes)
    .filter(lane => !reverseOnlyDropped.includes(lane.label)).flatMap(lane => lane.ports))
  const participatesInReverse = (item: VariantChoice) =>
    (suggestion?.binding.bindings || []).some((row, index) =>
      reversePorts.has(row.port_index ?? index) && row.model === item.selector
        && (row.side == null || row.side === item.side))
  const selectorChoices = (suggestion?.variant_choices || []).flatMap(item =>
    bothDirections && item.role !== 'unknown' && participatesInReverse(item)
      ? [item, { ...item, role: item.role === 'driver' ? 'receiver' as const : 'driver' as const }]
      : [item])
  const selectorInput = (item: VariantChoice): SelectorInput => {
    const answers = selectorAnswers[variantKey(item)]
    return {
      packageId: suggestion?.packages.find(p => p.side === item.side)?.package_id
        || (item.side === 0 ? packageId : rxPackageId || packageId),
      selector: item.selector, side: item.side, dataRateGbps: dataRate,
      driving: item.role === 'driver' ? true : item.role === 'receiver' ? false
        : suggestion?.bus_direction.driving_side == null ? null
          : suggestion.bus_direction.driving_side === item.side,
      odtOhm: answers?.odtOhm ?? null, driveOhm: answers?.driveOhm ?? null,
      directModel: item.direct_model || '',
    }
  }
  const currentDecision = (item: VariantChoice) => {
    const decision = selectorDecisions[variantKey(item)]
    return decision?.inputSignature === selectorSignature(selectorInput(item)) ? decision : null
  }
  const selectionBasis = {
    ...Object.fromEntries(selectorChoices
      .map(item => [variantKey(item), currentDecision(item)?.selectionBasis || {}])),
    ...(presetSelectionBasis ? { preset: presetSelectionBasis } : {}),
  }
  /** 這個選擇器最後會用哪一個變體：變體漏斗的決定（含使用者在漏斗裡的覆寫）。 */
  const pickedVariant = (item: VariantChoice, role = item.role) =>
    currentDecision({ ...item, role })?.model || ''
  const variantPending = selectorChoices
    .some(item => !currentDecision(item) || currentDecision(item)!.requiresUser)
  const directionPending = Boolean(suggestion)
    && suggestion!.bus_direction.driving_side === null
  const confirmationSignature = JSON.stringify([
    touchstone, packageId, rxPackageId, dataRate, suggestion, drivingSide,
    selectionBasis, portModels,
    riseTimePs, patternKind, transientUi, settleUi, bothPatterns,
    measureTiming, busMode, bothDirections, vddq, acOffset, dcOffset,
    tds, tdh, maskUi, maskMv, deratingText, corners, laneCount, dispositions,
    addrDriver, addrReceivers, addrCmdRate, addrResult,
  ])
  const confirmation = confirmationState(confirmedSignature, confirmationSignature)
  const canStart = Boolean(suggestion) && suggestion!.blockers.length === 0
    && missingDisposition.length === 0 && !variantPending && !directionPending && !busy
    && selectedLanes >= 1
    && confirmation === 'confirmed'

  /** 把某一次紀錄的物理輸入填回表單。
   *
   *  **只填得回去的填，填不回去的講出來**。半套還原比不還原更危險——
   *  使用者會以為表單已經完全回到那一版，然後拿一組混合的設定重跑。
   *  舊紀錄不動：ADR-0016 規定既有紀錄不得被新結果覆蓋。 */
  function restoreRun(run: RestorableRun) {
    if (run.touchstonePath) setTouchstone(run.touchstonePath)
    if (run.txPackageId) setPackageId(run.txPackageId)
    if (run.rxPackageId) setRxPackageId(run.rxPackageId)
    if (run.dataRateGbps > 0) setDataRate(run.dataRateGbps)
    setError(run.unrestored.length
      ? m.restoredPartial(run.unrestored.join(m.listSep))
      : m.restoredAll)
  }

  // CA 群組的送解放在第五步（第 4 步只做分組）。
  const addressDevices = () => (addrResult?.devices || []).map((device: any) => (
    <div key={device.device} className="field-row" style={{ alignItems: 'center' }}>
      <span>{m.device}<strong>{device.device}</strong>{m.laneCountParen(device.lanes.length)}</span>
      {device.strobe_labels?.length === 2
        ? <button className="btn"
            disabled={!suggestion || addrBusy || directionPending || variantPending || Boolean(job?.running)
              || Boolean(multiLaneBlock) || confirmation !== 'confirmed'}
            title={multiLaneBlock || (!suggestion ? m.needSuggestTip : directionPending ? m.needDirectionTip : m.startWithCkTip)}
            onClick={() => void startAddressRun(device.device)}>{m.startWithDevice(device.device)}</button>
        : <span className="hint">{pickText(device, 'why', lang)}</span>}
    </div>
  ))

  return (
    <div className="ibis-wizard multi-lane-wizard">
      {wizardStep === 5 && error && <p className="error">{error}</p>}
      {wizardStep === 5 && addrError && <p className="error">{addrError}</p>}
      {wizardStep === 5 && confirmation !== 'confirmed' && <p className="warning">
        {confirmation === 'stale' ? t.eyeWizard.stale : t.eyeWizard.missing.confirm}</p>}
      <section data-wizard-step={3} hidden={hiddenStep(3)}>
        <h3>{m.selectTitle}</h3>
        <p className="hint">
          {m.selectHint}</p>
        <label>{m.txPackage}<select className="input" value={packageId}
            onChange={event => setPackageId(event.target.value)}>
            <option value="">{m.choose}</option>
            {ibisPackages.map(item => (
              <option key={item.package_id} value={item.package_id}
                disabled={Boolean(sideBlocker(item, 'tx', m))}>
                {packageLabel(item, 'tx', m)}
              </option>
            ))}
          </select>
        </label>
        {/* 兩顆按鈕的文字必須寫明是哪一側。它們寫的是不同的 state（packageId
            與 rxPackageId），按錯會把控制器的模型自動選進顆粒那一側——而眼圖
            照畫、預檢照過，不會有任何錯誤訊息。同名時輔助技術的按鈕清單裡也
            會出現兩個一模一樣的項目，完全分不出來。 */}
        <button className="btn" disabled={busy} onClick={() => void importIbis('tx')}>
          {m.importTx}</button>
        <label>{m.rxPackage}<select className="input" value={rxPackageId}
            onChange={event => setRxPackageId(event.target.value)}>
            <option value="">{m.sameAsAbove}</option>
            {ibisPackages.map(item => (
              <option key={item.package_id} value={item.package_id}
                disabled={Boolean(sideBlocker(item, 'rx', m))}>
                {packageLabel(item, 'rx', m)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={busy} onClick={() => void importIbis('rx')}>
          {m.importRx}</button>
        {/* 這裡只收 kind === 'ibis'。不講的話，使用者匯完 AMI 套件回到這一頁，
            只會看到選單裡沒有它（2026-08-24 實測）。AMI 走精靈的單通道（≤4 埠）路徑。 */}
        {ibisPackages.length === 0 && amiPackages.length === 0 && <p className="hint">
          {m.libraryEmpty}</p>}
        {amiPackages.length > 0 && <p className="hint">
          {m.amiSkipped(amiPackages.length)}</p>}
        <p className="hint">{m.pickBoth}</p>
        {/* 速率在精靈第 2 步填，這裡不出第二個欄位；上升時間覆寫精靈也要看得到（#0104）。 */}
        <div>
        <label>{m.riseTime}<input className="input" type="number" value={riseTimePs}
            placeholder={dataRate > 0 ? m.riseTimePlaceholder((200 / dataRate).toFixed(0)) : ''}
            onChange={event => setRiseTimePs(event.target.value)} />
        </label>
        <p className="hint">{m.riseHint1}</p>
        <p className="hint">{m.riseHint2}</p>
        <p className="hint">{m.riseHint3}</p>
        </div>
        <button className="btn" disabled={!touchstone || !packageId || !(dataRate > 0) || busy}
          onClick={() => void runSuggest()}>{busy ? m.working : m.runSuggest}</button>
        {error && <p className="error">{error}</p>}
      </section>

      {/* #0104：精靈模式也看得到，放在第 3 步（選完套件就能跑）。 */}
      <section data-wizard-step={3} hidden={hiddenStep(3)}>
        <h3>{t.eyeWizard.quickTitle}</h3>
        {/* 不接使用者通道：TX 與 RX 之間放的是工具自產的參考線——近無損
            直連看模型本來的眼，有損檔位看典型中等損耗下還剩多少。
            模型由套件角色自動挑，不需要 Touchstone。 */}
        {/* 和單通道共用同一段說明（畫面驗收 T11）。 */}
        <p className="hint">{t.eyeWizard.quickHint}</p>
        <p className="hint">{t.eyeWizard.quickAttribution}</p>
        <label style={{ display: 'flex', flexDirection: 'row', gap: 6,
          alignItems: 'center' }}>
          <input type="checkbox" checked={lossyReference}
            style={{ width: 'auto' }}
            onChange={event => setLossyReference(event.target.checked)} />
          {t.eyeWizard.lossyReference}</label>
        <button className="btn" disabled={!packageId || !(dataRate > 0) || busy || Boolean(job?.running)
          || Boolean(quickCheckBlock)}
          title={quickCheckBlock || undefined}
          onClick={() => void runQuickCheck()}>
          {busy ? m.working : m.quickRun}
        </button>
        <LicenseTag functions={['model_check']} />
        {quickCheck && <p className="hint">
          {m.quickQueued(quickCheck.txModel, quickCheck.rxModel)}</p>}
      </section>

      <section data-wizard-step={4} hidden={hiddenStep(4)}>
        <details>
          <summary>{m.addrTitle}</summary>
          <p className="hint">
            {m.addrHint1}</p>
          <p className="hint">
            {m.addrHint2}</p>
          <div className="field-row">
            <label>{m.addrDriver}<input className="input" value={addrDriver} placeholder="U1"
                onChange={event => setAddrDriver(event.target.value)} />
            </label>
            <label>{m.addrReceivers}<input className="input" value={addrReceivers}
                placeholder="U35, U37"
                onChange={event => setAddrReceivers(event.target.value)} />
            </label>
            <label>{m.cmdRate}<select className="input" value={addrCmdRate}
                onChange={event => setAddrCmdRate(
                  event.target.value as '1T' | '2T')}>
                <option value="1T">1T</option>
                <option value="2T">2T</option>
              </select>
            </label>
            <button className="btn" disabled={!touchstone || !addrDriver || addrBusy}
              onClick={() => void analyzeAddressGroup()}>
              {addrBusy ? m.grouping : m.analyzeGroups}
            </button>
          </div>
          {addrError && <p className="error">{addrError}</p>}
          {addrResult && <>
            <p className="hint">
              {m.addrLanes(addrResult.lanes.length, addrResult.clock_nets.length)}
              {addrResult.windows
                ? m.addrWindows(addrResult.windows.clock_period_ps?.toFixed(0), addrResult.windows.address_window_ps?.toFixed(0), addrCmdRate)
                : ''}
            </p>
            {(addrResult.unassigned || []).length > 0 && (
              <p className="hint" style={{ color: '#e3b341' }}>
                {m.unassignedLead(addrResult.unassigned.length)}
                {addrResult.unassigned.slice(0, 4).map((item: any) => item.port).join(m.listSep)}
                {m.unassignedTail}</p>
            )}
            <p className="hint">
              {m.addrFootnote}</p>
          </>}
        </details>
      </section>

      <section data-wizard-step={5} hidden={hiddenStep(5)}>
        {!suggestion && <p className="hint">{m.needSuggestTip}</p>}
        {addrResult && <><h3>{m.addrTitle}</h3>{addressDevices()}</>}
      </section>

      {suggestion && <>
        {/* 放在選兩端晶片的這一步：使用者在這裡就能換模型。不擋（ADR-0050）。 */}
        {bothDramWarning && <section data-wizard-step={3} hidden={hiddenStep(3)}>
          <p className="warning"><strong>{t.multiLanePreflight.bothDramTitle}</strong></p>
          <p className="hint">{bothDramWarning}</p>
        </section>}
        <section data-wizard-step={4} hidden={hiddenStep(4)}>
          <div className="eye-wizard__diagram" data-report-separate-snapshot="true"
            data-report-kind="multiport-wiring" data-report-title={t.eyeWizard.steps.wiring}>
            <div className="eye-wizard__box">
              <strong>{t.eyeWizard.tx}</strong>
              {(suggestion.packages || []).filter(item => item.side === suggestion.bus_direction.driving_side)
                .map(item => <span key={item.side}>{item.display_name}</span>)}
              {suggestion.variant_choices.filter(item => item.role === 'driver')
                .map(item => <div key={variantKey(item)}><code>{item.selector}{m.fieldSep}{pickedVariant(item) || '—'}</code>
                  <em>{currentDecision(item)?.selectionBasis.basis === 'override'
                    ? t.eyeWizard.diagramReason.override(String(currentDecision(item)?.selectionBasis.override_reason || ''))
                    : currentDecision(item)?.selectionBasis.basis === 'plain'
                      ? t.eyeWizard.diagramReason.plain : t.eyeWizard.diagramReason.funnel}</em></div>)}
              <span>{m.singleRunCorner}</span>
            </div>
            <div className="eye-wizard__wire">
              <strong>{t.eyeWizard.diagramChannel}</strong>
              <code>{touchstone.split(/[\\/]/).pop()}</code>
              {suggestion.touchstone.sha256 && <code>SHA-256{m.fieldSep}{suggestion.touchstone.sha256}</code>}
              {lanes.slice(0, selectedLanes).map((lane, index) => <span key={lane.label}>
                {lane.label}{m.fieldSep}{suggestion.lane_orientation[index]
                  ? `${suggestion.lane_orientation[index].input_port} → ${suggestion.lane_orientation[index].output_port}`
                  : '—'}</span>)}
            </div>
            <div className="eye-wizard__box">
              <strong>{t.eyeWizard.rx}</strong>
              {(suggestion.packages || []).filter(item => item.side === suggestion.bus_direction.receiving_side)
                .map(item => <span key={item.side}>{item.display_name}</span>)}
              {suggestion.variant_choices.filter(item => item.role === 'receiver')
                .map(item => <div key={variantKey(item)}><code>{item.selector}{m.fieldSep}{pickedVariant(item) || '—'}</code>
                  <em>{currentDecision(item)?.selectionBasis.basis === 'override'
                    ? t.eyeWizard.diagramReason.override(String(currentDecision(item)?.selectionBasis.override_reason || ''))
                    : currentDecision(item)?.selectionBasis.basis === 'plain'
                      ? t.eyeWizard.diagramReason.plain : t.eyeWizard.diagramReason.funnel}</em></div>)}
              <span>{t.multiLane.cornersTitle}{m.fieldSep}{corners.join(m.listSep)}</span>
            </div>
          </div>
          <label className="eye-wizard__confirm">
            <input type="checkbox" checked={confirmation === 'confirmed'}
              disabled={busy || variantPending || directionPending || suggestion.blockers.length > 0}
              onChange={event => setConfirmedSignature(event.target.checked ? confirmationSignature : null)} />
            {t.eyeWizard.confirm}
          </label>
          {confirmation === 'stale' && <p className="warning">{t.eyeWizard.stale}</p>}
        </section>
        <section data-wizard-step={4} hidden={hiddenStep(4)}>
          <h3>{m.groupTitle}</h3>
          <p>
            <strong>{suggestion.analysis_kind === 'byte_lane' ? m.byteLane : m.multiLaneCrosstalk}</strong>
            {m.lanesCount(suggestion.binding.lanes.length)}
            {m.sideBasis(pickText(suggestion.binding.sides, 'basis', lang))}
            {pickList(suggestion.binding.sides, 'labels', lang).length > 0 &&
              m.paren(pickList(suggestion.binding.sides, 'labels', lang).map((label, index) => {
                const alias = suggestion.binding.sides.label_aliases?.[index] ?? []
                return alias.length > 0 ? `${label}${m.aliasJoin}${alias.join(m.aliasJoin)}` : label
              }).join(' ↔ '))}
          </p>
          <p className="hint">{pickText(suggestion.group, 'why', lang)}</p>
          {suggestion.group.strobe_pairs.length === 0 &&
            <p className="hint">{t.multiLanePreflight.noStrobeHowTo}</p>}
          {/* 哪一份套件對到哪一側是推出來的：填反了不會報錯，只會讓眼圖
              用錯緩衝器，所以一定要顯示出來讓人核對。 */}
          {(suggestion.packages || []).length === 2 && <p className="hint">
            {m.packagesLead}{suggestion.packages.map(item => (
              <span key={item.side}>
                {item.side > 0 ? m.sideSep : ''}
                {m.sideN(item.side + 1)}{pickList(suggestion.binding.sides, 'labels', lang)[item.side]
                  ? m.paren(pickList(suggestion.binding.sides, 'labels', lang)[item.side]) : ''}
                {m.equals}{item.display_name || m.unspecified}
                {item.component ? `${m.slash}${item.component}` : ''}
              </span>
            ))}
            {suggestion.two_package && suggestion.package_assignment?.swapped &&
              m.swappedNote}
            {suggestion.two_package && suggestion.package_assignment?.tie &&
              m.tieNote}
          </p>}
          {suggestion.group.strobe_pairs.map(pair => (
            <p key={pair.labels.join()} className="hint">
              {m.strobeLine(pair.labels.join(' / '), pair.pins.join(' / '))}
            </p>
          ))}
        </section>

        <section data-wizard-step={4} hidden={hiddenStep(4)}>
          <h3>{m.busTitle}</h3>
          {/* ADR-0049：方向決定哪一側接驅動緩衝器。接反了電路照樣解得動、
              眼圖照樣畫得出來，只是量到的是反方向的通道——沒有任何跡象。
              單向訊號由 Model_type 定死，不給選；雙向 I/O 必選，不給預設。 */}
          <p className="hint">{pickText(suggestion.bus_direction, 'reason', lang)}</p>
          {suggestion.bus_direction_applies ? <>
            <label>{m.drivingSide}<span className="required">{m.required}</span>
              <select className="input"
                value={suggestion.bus_direction.driving_side ?? ''}
                onChange={event => {
                  const value = event.target.value === '' ? null : Number(event.target.value)
                  setDrivingSide(value)
                  void runSuggest(value)
                }}>
                <option value="">{m.choose}</option>
                {suggestion.bus_direction.sides
                  .filter(item => suggestion.bus_direction.feasible.includes(item.side))
                  .map(item => (
                    <option key={item.side} value={item.side}>
                      {m.sideDrives(item.side + 1, item.label)}</option>
                  ))}
              </select>
            </label>
          </> : (
            <p>
              {m.drivingSideIs}<strong>
                {suggestion.bus_direction.driving_side === null ? m.undecided
                  : m.sideWithLabel(suggestion.bus_direction.driving_side + 1, suggestion.bus_direction.sides[suggestion.bus_direction.driving_side].label)}
              </strong>
              {suggestion.bus_direction.basis === 'model_type' && m.fixedByModelType}
            </p>
          )}
          <table className="model-library__table">
            <thead><tr><th>{m.colSide}</th><th>Model_type</th><th>{m.colCanDrive}</th><th>{m.colCanReceive}</th></tr></thead>
            <tbody>{suggestion.bus_direction.sides.map(item => (
              <tr key={item.side}>
                <td>{m.sideWithLabel(item.side + 1, item.label || '—')}</td>
                <td>{item.model_types.join(m.listSep) || '—'}</td>
                <td>{item.can_drive ? m.yes : m.no}</td>
                <td>{item.can_receive ? m.yes : m.no}</td>
              </tr>
            ))}</tbody>
          </table>
          {suggestion.bus_direction.lanes.some(item => item.feasible.length === 0) &&
            <details open>
              <summary>
                {m.blockingLanes(suggestion.bus_direction.lanes
                  .filter(item => item.feasible.length === 0).length)}</summary>
              {/* 位元組通道本來就會混著單向道與雙向道：DDR 的資料遮罩由控制器
                  單向驅動，記憶體端沒有它的驅動器。這不是檔案壞掉。 */}
              <table className="model-library__table">
                <thead><tr><th>{m.colLane}</th><th>{m.colModels}</th><th>{m.colReason}</th></tr></thead>
                <tbody>{suggestion.bus_direction.lanes
                  .filter(item => item.feasible.length === 0).map(item => (
                    <tr key={item.label}>
                      <td>{item.label}</td>
                      <td>{item.models.map(name => name || '—').join(' ↔ ')}</td>
                      <td>{pickText(item, 'why', lang)}</td>
                    </tr>
                  ))}</tbody>
              </table>
              <p className="hint">
                {m.blockingHint(suggestion.bus_direction.feasible_without_blocking_lanes
                  .map(side => m.sideN(side + 1)).join(m.or) || m.noFeasible)}</p>
            </details>}
          {suggestion.lane_orientation.length > 0 && <details>
            <summary>{m.orientation(suggestion.lane_orientation.length)}</summary>
            <table className="model-library__table">
              <thead><tr><th>{m.colLane}</th><th>{m.colDriverPort}</th><th>{m.colReceiverPort}</th></tr></thead>
              <tbody>{suggestion.lane_orientation.map(item => (
                <tr key={item.label}>
                  <td>{item.label}</td><td>{item.input_port}</td><td>{item.output_port}</td>
                </tr>
              ))}</tbody>
            </table>
          </details>}
        </section>

        {suggestion.blockers.length > 0 && <section className="blockers" data-wizard-step={4} hidden={hiddenStep(4)}>
          <h3>{m.blockersTitle}</h3>
          <ul>{pickList(suggestion, 'blockers', lang).map(text => <li key={text}>{text}</li>)}</ul>
        </section>}

        {suggestion.warnings.length > 0 && <section data-wizard-step={4} hidden={hiddenStep(4)}>
          <h3>{m.warningsTitle}</h3>
          <ul>{pickList(suggestion, 'warnings', lang).map(text => <li key={text}>{text}</li>)}</ul>
        </section>}

        <section data-wizard-step={4} hidden={hiddenStep(4)}>
          <h3>{m.bindingTitle}</h3>
          {/* 分級整批確認：高證據的預先配好、一次確認；partial 必須逐一檢視。
              顯示的是「對上了幾個鍵」這種可稽核的證據，不是信心分數。 */}
          <p>
            {(['high', 'partial', 'none'] as const).map(level => (
              <span key={level} style={{ marginRight: '1.5em' }}>
                {m.evidence[level]}{m.fieldSep}<strong>{suggestion.binding.evidence_counts[level] ?? 0}</strong> {m.countSuffix}</span>
            ))}
          </p>
          {suggestion.binding.components.map((item, index) => item.ranking.length > 0 && (
            <details key={index}>
              <summary>
                {m.sideComponent(index + 1)}{item.selected || m.tieNotSelected}
              </summary>
              <table className="model-library__table">
                <thead><tr><th>{m.colComponent}</th><th>{m.colTwoKey}</th><th>{m.colUniqueSignal}</th><th>{m.colBasis}</th></tr></thead>
                <tbody>{item.ranking.map(rank => (
                  <tr key={rank.component}>
                    <td>{rank.component}</td><td>{rank.two_key_ports}</td>
                    <td>{rank.unique_signal_ports}</td><td>{pickText(rank, 'basis', lang)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </details>
          ))}
          <details>
            <summary>{m.perPort(suggestion.binding.bindings.length)}</summary>
            <table className="model-library__table">
              <thead><tr><th>Port</th><th>{m.colSide}</th><th>{m.colPin}</th><th>{m.colSignal}</th><th>{m.colModel}</th><th>{m.colEvidence}</th></tr></thead>
              <tbody>{suggestion.binding.bindings.map(row => (
                <tr key={row.port_index}>
                  <td>{row.port}</td><td>{row.side_label || '—'}</td>
                  <td>{row.pin || '—'}</td><td>{row.signal || '—'}</td>
                  <td>{row.model || '—'}</td>
                  <td>{m.evidence[row.evidence]}
                    {row.keys.length > 0 && m.paren(row.keys.join(m.plus))}</td>
                </tr>
              ))}</tbody>
            </table>
          </details>
        </section>

        <section data-wizard-step={3} hidden={hiddenStep(3)}>
          <h3>{m.variantsTitle}</h3>
          {bothDirections && <p className="hint">{t.eyeWizard.reverseVariants}</p>}
          {selectorChoices.map(choice => {
            const input = selectorInput(choice)
            const key = variantKey(choice)
            return <div key={key}>
              <p><strong>{m.sideN(choice.side + 1)}{m.fieldSep}
                {choice.role === 'driver' ? t.eyeWizard.tx : t.eyeWizard.rx}</strong></p>
              <SelectorFunnelPanel choice={choice} {...input}
              onChange={decision => {
                setSelectorAnswers(previous => {
                  const old = previous[key]
                  return old?.odtOhm === decision.odtOhm && old?.driveOhm === decision.driveOhm
                    ? previous : { ...previous, [key]: { odtOhm: decision.odtOhm, driveOhm: decision.driveOhm } }
                })
                setSelectorDecisions(previous => JSON.stringify(previous[key]) === JSON.stringify(decision)
                  ? previous : { ...previous, [key]: decision })
              }} />
            </div>
          })}
          {/* 上升時間對應的可用頻寬（舊進階頁籤只在這裡顯示，ADR-0067 搬來第 3 步）。 */}
          {suggestion.bandwidth && <p className="hint">
            {m.edgeBandwidth(suggestion.bandwidth.rise_time_ps.toFixed(0), suggestion.bandwidth.usable_bandwidth_ghz.toFixed(2), suggestion.bandwidth.sweep_max_ghz.toFixed(2))}</p>}
        </section>

        <section data-wizard-step={4} hidden={hiddenStep(4)}>
          <h3>{m.scopeTitle}</h3>
          <label>{m.laneCountLabel}<input className="input" type="number" min={1} max={lanes.length}
              value={selectedLanes}
              onChange={event => {
                // 清空欄位時 `Number('')` 是 0，會讓「最差碼型涵蓋率」用 0 條道
                // 去算，印出滿分覆蓋率並附上「-1 條攻擊者」。空的就回到未指定。
                const value = Number(event.target.value)
                setLaneCount(Number.isFinite(value) && value >= 1 ? value : null)
              }} />
          </label>
          <label>{m.pattern}<select className="input" value={patternKind}
              disabled={bothPatterns}
              onChange={event => setPatternKind(event.target.value as 'worst_case' | 'prbs')}>
              <option value="worst_case">{m.patternWorst}</option>
              <option value="prbs">{m.patternPrbs}</option>
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={bothPatterns}
              onChange={event => setBothPatterns(event.target.checked)} />
            {m.bothPatterns}</label>
          {bothPatterns && <>
            <p className="hint">{m.bothHint1}</p>
            <p className="hint">{m.bothHint2}</p>
            <p className="hint">{m.bothHint3}</p>
          </>}
          {patternKind === 'worst_case' ? <>
            <label>{m.settleUi}<input className="input" type="number" min={1} value={settleUi}
                onChange={event => setSettleUi(Number(event.target.value))} />
            </label>
            <p className="hint">
              {m.worstCaseUi(selectedLanes * 2 * 2 * settleUi)}
            </p>
          </> : <>
            <label>{m.transientUi}<input className="input" type="number" min={1} value={transientUi}
                onChange={event => setTransientUi(Number(event.target.value))} />
            </label>
            {/* ADR-0045：隨機碼型的涵蓋率必須顯示，否則使用者會把
                「沒看到最差」誤讀成「沒有問題」。 */}
            <p className="warning">
              {m.expectationLead}<strong>{worstCaseExpectation(selectedLanes, transientUi).toFixed(4)}</strong>
              {m.aggressors(selectedLanes - 1)}
              {m.expectationWarnLead}<b>{m.notWorstCase}</b>{m.period}</p>
          </>}
        </section>

        {portsNeedingModel.length > 0 && <section data-wizard-step={4} hidden={hiddenStep(4)}>
          <h3>{m.noPinTitle(portsNeedingModel.length)}</h3>
          <p className="hint">
            {m.noPinHint1}</p>
          <p className="hint">
            {m.noPinHint2}</p>
          <p className="hint">
            {m.noPinHint3}</p>
          <p className="hint">
            {m.noPinHint4}</p>
          <p className="hint">
            {m.noPinHint5}</p>
          <table className="model-library__table">
            <thead><tr><th>Port</th><th>{m.colBuffer}</th></tr></thead>
            <tbody>{portsNeedingModel.map(item => (
              <tr key={item.index}>
                <td>{item.name}</td>
                <td>
                  <select className="input" aria-label={m.bufferAria(item.name)}
                    value={portModels[item.index] ?? ''}
                    onChange={event => setPortModels(previous => {
                      const next = { ...previous }
                      if (event.target.value) next[item.index] = event.target.value
                      else delete next[item.index]
                      return next
                    })}>
                    <option value="">{m.unspecifiedParen}</option>
                    {bufferChoices.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {Object.keys(portModels).length > 0 && <p className="hint">
            {m.assignedCount(Object.keys(portModels).length)}</p>}
        </section>}

        {portsNeedingDisposition.length > 0 && <section data-wizard-step={4} hidden={hiddenStep(4)}>
          <h3>{m.dispTitle(portsNeedingDisposition.length)}</h3>
          {/* 留著不接等於默默選了開路，而開路與終結給出不同的串擾結果——
              實測差 3.7 mV 峰值。兩者都不是安全預設（ADR-0046）。 */}
          <p className="hint">
            {m.dispHint}</p>
          <table className="model-library__table">
            <thead><tr><th>Port</th><th>{m.colDisposition}</th><th>{m.colOhm}</th><th>{m.colVref}</th></tr></thead>
            <tbody>{portsNeedingDisposition.map(item => {
              const plan = dispositions[item.index]
              return (
                <tr key={item.index}>
                  <td>{item.name}</td>
                  <td>
                    <select className="input" aria-label={m.dispAria(item.name)}
                      value={plan?.kind ?? ''}
                      onChange={event => setDispositions(previous => ({
                        ...previous,
                        [item.index]: { kind: event.target.value as Disposition['kind'] },
                      }))}>
                      <option value="">{m.choose}</option>
                      <option value="terminate">{m.terminate}</option>
                      <option value="open">{m.open}</option>
                      <option value="ground">{m.ground}</option>
                    </select>
                  </td>
                  <td>{plan?.kind === 'terminate' && (
                    <input className="input" type="number" aria-label={m.termOhmAria(item.name)}
                      value={plan.impedance_ohm ?? ''}
                      onChange={event => setDispositions(previous => ({
                        ...previous,
                        [item.index]: { ...plan, impedance_ohm: Number(event.target.value) },
                      }))} />
                  )}</td>
                  <td>{plan?.kind === 'terminate' && (
                    <input className="input" type="number" step="0.01"
                      aria-label={m.termVrefAria(item.name)}
                      value={plan.reference_volt ?? ''}
                      onChange={event => setDispositions(previous => ({
                        ...previous,
                        [item.index]: { ...plan, reference_volt: Number(event.target.value) },
                      }))} />
                  )}</td>
                </tr>
              )
            })}</tbody>
          </table>
          {missingDisposition.length > 0 && <p className="warning">
            {m.dispIncomplete(missingDisposition.length)}</p>}
        </section>}

        {suggestion.quality.executed && <section data-wizard-step={4} hidden={hiddenStep(4)}>
          <h3>{m.qualityTitle}</h3>
          {/* 分兩層顯示：檔案固有的性質與這次激勵是否充分是兩件事，
              合併成一個通過與否會讓人把「這次夠用」誤讀成「這個檔案沒問題」
              （ADR-0048）。 */}
          {suggestion.quality.intrinsic && <>
            <h4>{m.intrinsic}</h4>
            <p>{m.passivity(String(suggestion.quality.intrinsic.passivity_max_singular_value))}</p>
            <p>{m.causality}{suggestion.quality.intrinsic.causality_precursor_energy_ratio ?? m.notMeasurable}
              {m.lanesTotal(suggestion.quality.intrinsic.causality_per_path.length)}</p>
          </>}
          <h4>{m.excitation}</h4>
          <table className="model-library__table">
            <thead><tr><th>{m.colItem}</th><th>{m.colValue}</th><th>{m.colLimit}</th><th>{m.colVerdict}</th></tr></thead>
            <tbody>{(suggestion.quality.checks ?? [])
              .filter(row => ['bandwidth', 'frequency_resolution', 'dc_extrapolation'].includes(row.check))
              .map(row => (
                <tr key={row.check}>
                  <td>{pickText(row, 'label', lang)}</td><td>{row.value ?? '—'}</td><td>{row.limit}</td>
                  <td>{row.status === 'pass' ? m.pass : row.status === 'fail' ? m.fail : m.notMeasurable}</td>
                </tr>
              ))}</tbody>
          </table>
        </section>}

        {/* 沒有選通就沒有時序裕度這個量（ADR-0044），所以整段跟著選通出現。 */}
        {strobePair && <section data-wizard-step={4} hidden={hiddenStep(4)}>
          <h3>{m.timingTitle}</h3>
          <label>
            <input type="checkbox" checked={measureTiming}
              onChange={e => setMeasureTiming(e.target.checked)} />
             {t.library.spacer}{m.measureTiming}</label>
          <p className="hint">{m.strobeIs(strobePair.labels.join(' / '))}</p>
          <p className="hint">{m.timingHint}</p>

          {measureTiming && <>
            <label>{m.direction}<select className="input" value={busMode}
                onChange={e => setBusMode(e.target.value as 'write' | 'read')}>
                <option value="write">{m.write}</option>
                <option value="read">{m.read}</option>
              </select>
            </label>
            <p className="hint">
              {m.strobePhase(String(strobePhaseUi))}</p>
            <p className="hint">{m.strobeAlignHint}</p>

            <h4>{m.thresholdsTitle}</h4>
            <div className="field-row">
              <label>{m.vddq}<input className="input" type="number" step="0.01" value={vddq}
                  onChange={e => setVddq(e.target.value)} />
              </label>
              <label>{m.acOffset}<input className="input" type="number" step="0.005" value={acOffset}
                  onChange={e => setAcOffset(e.target.value)} />
              </label>
              <label>{m.dcOffset}<input className="input" type="number" step="0.005" value={dcOffset}
                  onChange={e => setDcOffset(e.target.value)} />
              </label>
            </div>
            <p className="hint">
              {m.thresholdSummary(Number.isFinite(vref) ? vref.toFixed(3) : '—',
                thresholds.vih_ac.toFixed(3), thresholds.vil_ac.toFixed(3),
                thresholds.vih_dc.toFixed(3), thresholds.vil_dc.toFixed(3))}
            </p>
            <p className="hint">{m.acDcHint}</p>

            <h4>{m.specTitle}</h4>
            <div className="field-row">
              <label>{m.tds}<input className="input" type="number" value={tds}
                  onChange={e => setTds(e.target.value)} />
              </label>
              <label>{m.tdh}<input className="input" type="number" value={tdh}
                  onChange={e => setTdh(e.target.value)} />
              </label>
            </div>
            <p className="hint">{m.specHint1}</p>
            <p className="hint">{m.specHint2}</p>
            <p className="hint">{m.specHint3}</p>

            <div className="field-row">
              <label>{m.maskWidth}<input className="input" type="number" step="0.01" value={maskUi}
                  onChange={e => setMaskUi(e.target.value)} />
              </label>
              <label>{m.maskHeight}<input className="input" type="number" value={maskMv}
                  onChange={e => setMaskMv(e.target.value)} />
              </label>
            </div>
            <p className="hint">{m.maskHint1}</p>
            <p className="hint">{m.maskHint2}</p>
            <p className="hint">{m.maskHint3}</p>

            <label>{m.deratingLabel}<textarea className="input" rows={4} value={deratingText}
                placeholder={'{"tds_ps":[{"slew_v_per_ns":1.0,"adjust_ps":125},'
                  + '{"slew_v_per_ns":4.0,"adjust_ps":0}]}'}
                onChange={e => setDeratingText(e.target.value)} />
            </label>
            <p className="hint">{m.deratingHint1}</p>
            <p className="hint">{m.deratingHint2}</p>
            <p className="hint">{m.deratingHint3}</p>
            {derating.error && <p className="warning">
              {m.deratingError(derating.error)}</p>}
            {derating.table !== null && !derating.error && <p className="hint">
              {m.deratingLoaded(Object.keys(derating.table as object).join(m.listSep))}</p>}
          </>}
        </section>}

        <section data-wizard-step={5} hidden={hiddenStep(5)}>
          <h3>{m.submitTitle}</h3>
          <button className="btn" disabled={!canStart || Boolean(multiLaneBlock)}
            title={multiLaneBlock || undefined}
            onClick={() => void start(false)}>
            {busy ? m.working : m.startMulti}
          </button>
          <LicenseTag functions={['multi_lane']} />
          {/* #0088 小修 7：單次執行固定 typ，原本畫面沒寫。 */}
          <p className="hint">{m.singleRunCorner}</p>

          {/* 最差條件由結果排序得出，不預先假設 Slow 最差（ADR-0011）。 */}
          <h4>{m.cornersTitle}</h4>
          <div className="field-row">
            {[['typ', 'Typical'], ['min', 'Slow'], ['max', 'Fast']].map(([code, label]) => (
              <label key={code}>
                <input type="checkbox" checked={corners.includes(code)}
                  onChange={e => setCorners(prev => e.target.checked
                    ? [...prev, code] : prev.filter(c => c !== code))} />
                 {t.library.spacer}{label}
              </label>
            ))}
          </div>
          <label>
            <input type="checkbox" checked={bothDirections}
              onChange={e => setBothDirections(e.target.checked)} />
             {t.library.spacer}{m.bothDirections}</label>
          {bothDirections && reverseOnlyDropped.length > 0 && <p className="hint">
            {m.reverseDropped(reverseOnlyDropped.join(m.listSep))}</p>}
          <button className="btn" disabled={!canStart || corners.length === 0 || Boolean(multiLaneBlock)}
            title={multiLaneBlock || undefined}
            onClick={() => void start(true)}>
            {busy ? m.working
              : m.sweepN(corners.length * (bothDirections ? 2 : 1))}
          </button>
          <p className="hint">{m.sweepHint}</p>
          <p className="hint">{m.worstFromResults}</p>
          {!canStart && !busy && <p className="hint">
            {confirmation !== 'confirmed'
              ? confirmation === 'stale' ? t.eyeWizard.stale : t.eyeWizard.missing.confirm
              : suggestion.blockers.length > 0 ? m.blockedByBlockers
              : directionPending ? m.blockedByDirection
                : variantPending ? m.blockedByVariant
                  : missingDisposition.length > 0 ? m.blockedByDisposition : ''}
          </p>}
          {started && <p>{started}</p>}
        </section>

      </>}

      {(shownJob && shownJob.status !== "idle") && <section data-wizard-step={5} hidden={hiddenStep(5)}>
        <h3>{m.statusTitle}</h3>
          <div className={`ibis-wizard__job is-${shownJob?.status || 'idle'}`}>
            <div><strong>{pickText(shownJob, 'phase', lang) || m.notRun}</strong><span>{pickText(shownJob, 'message', lang)}</span></div>
            <div>{m.jobLine(shownJob?.status || 'idle', jobElapsed, shownJob?.job_id || '—')}</div>
          </div>
          {shownJob?.error && <div className="model-library__issue is-error">
            {m.failed(pickText(shownJob, 'error', lang))}</div>}

          {/* 執行警告要跟著結果一起看——特別是「帶錯誤放行」：這份眼圖
              是帶著相容性錯誤跑出來的，判讀時要對照原話。 */}
          {(jobResult?.warnings?.length ?? 0) > 0 && (
            <details open={releasedWithErrors(jobResult)}>
              <summary>{m.runWarnings(jobResult.warnings.length)}</summary>
              <ul>{pickList(jobResult, 'warnings', lang).map((w: string) => (
                <li key={w} className="hint">{w}</li>
              ))}</ul>
            </details>
          )}

          {/* #0115：結果頁只放眼圖；排序表、逐訊號時序、量測收進「眼圖參數」抽屜。
              最差 Corner 與判定留一行在頁面上——FAIL 不能藏在按鈕後面。 */}
          {eyeCards.length > 0 && ranking?.ranked?.length > 0 && (() => {
            const worst = ranking.ranked[0]
            const detail = (ranking.per_corner || []).find((item: any) => item.corner === worst.corner) || {}
            return <p className="warning">
              {m.worstCornerSummary(String(worst.corner), Number(worst.value).toFixed(1), String(detail.verdict || '—'))}</p>
          })()}
          {(eyeCards.length > 0 || Boolean(jobResult?.run_dir || jobResult?.output_dir)) && <div className="eye-results__toolbar">
            {eyeCards.length > 0 && <h4>{m.eyeCount(eyeCards.length)}</h4>}
            {eyeCards.length > 0 && <button type="button" className="btn"
              aria-expanded={details.open} onClick={details.toggle}>
              {t.resultDetails.open}</button>}
            <OpenFolderButton path={jobResult?.run_dir || jobResult?.output_dir} />
          </div>}
          {eyeCards.length > 0 && <EyeImageGallery items={eyeCards.map(card => ({
            key: card.key, title: card.title, sub: card.corner, url: card.imageUrl,
            alt: m.eyeAlt(card.title),
            reportKind: `multilane-${card.key}`, reportTitle: m.reportEyeTitle(card.title),
          }))} />}
          <ResultDetailsDrawer open={details.open} onClose={details.close} inline={eyeCards.length === 0}>
          {/* Corner 掃描：先給排序表——看的人第一個問題是「哪個最差」。 */}
          {ranking?.ranked?.length > 0 && <>
            <h4>{m.rankingTitle}</h4>
            <table className="model-library__table">
              <thead><tr><th>Corner</th><th>{m.colWorstSetup}</th>
                <th>{m.colWorstSignal}</th><th>{m.colVerdict}</th></tr></thead>
              <tbody>{ranking.ranked.map((row: any) => {
                const detail = (ranking.per_corner || []).find(
                  (item: any) => item.corner === row.corner) || {}
                return <tr key={row.corner}>
                  <td>{row.corner}</td>
                  <td>{Number(row.value).toFixed(1)}</td>
                  <td>{detail.worst_signal || '—'}</td>
                  <td>{detail.verdict || '—'}</td>
                </tr>
              })}</tbody>
            </table>
            <p className="hint">{m.worstFromResults}</p>
          </>}

          {signalTables.map((table: any, index: number) => (
            <div key={index}>
              <h4>{m.perSignal}{table.corner ? `${m.gap}${table.corner}` : ''}</h4>
              <table className="model-library__table">
                <thead><tr><th>{m.colSignal}</th><th>{m.colDriverPin}</th><th>{m.colReceiverPin}</th>
                  <th>Setup (ps)</th><th>Hold (ps)</th><th>tVAC (ps)</th>
                  <th>{m.colEdges}</th><th>{m.colVerdict}</th></tr></thead>
                <tbody>{(table.rows || []).map((row: any) => (
                  <tr key={row.signal}>
                    <td>{row.signal}</td><td>{row.driver_pin}</td>
                    <td>{row.receiver_pin}</td>
                    <td>{fmtPs(row.metrics?.setup_margin_ps)}</td>
                    <td>{fmtPs(row.metrics?.hold_margin_ps)}</td>
                    <td>{fmtPs(row.metrics?.tvac_ps)}</td>
                    <td>{row.edge_count ?? '—'}</td>
                    <td>{row.verdict}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ))}

          {/* 沒量到時要講清楚是哪一種「沒量到」，三種要做的事完全不同。 */}
          {timingWhy && <p className="hint">{timingWhy}</p>}

          {/* JEDEC slew 極值（乙8 接線）：全週期 DC→AC 段斜率的最小值，
              derating 查表用的就是它。逐道列最慢的上升與下降。 */}
          {(() => {
            const timingLanes = jobResult?.sweep
              ? (jobResult.runs?.[0]?.result?.timing?.lanes || [])
              : (jobResult?.timing?.lanes || [])
            const withSlew = timingLanes.filter(
              (row: any) => row.slew_rise_min_v_per_ns !== undefined
                || row.slew_fall_min_v_per_ns !== undefined)
            if (!withSlew.length) return null
            return (
              <p className="hint">
                {m.slewLead}{withSlew.slice(0, 8).map((row: any) =>
                  m.slewRow(row.label, row.slew_rise_min_v_per_ns?.toFixed(2) ?? '—', row.slew_fall_min_v_per_ns?.toFixed(2) ?? '—')
                ).join(m.listSemi)}
                {withSlew.length > 8 ? m.moreLanes(withSlew.length) : ''}
              </p>
            )
          })()}

          {/* CK／選通品質（乙7）：AC 區間內的邊緣單調性。不單調＝有
              double clocking 風險，而眼圖看不出來（折疊後台階被蓋掉）。 */}
          {(() => {
            const ck = jobResult?.sweep
              ? (jobResult.runs?.[0]?.result?.timing?.ck_quality || [])
              : (jobResult?.timing?.ck_quality || [])
            if (!ck.length) return null
            return (
              <p className="hint">
                {m.ckLead}{ck.map((item: any) => item.why
                  ? `${item.label}${m.paren(pickText(item, 'why', lang))}`
                  : `${item.label} ${item.monotonic ? m.monotonic : m.nonMonotonic(item.violation_count, item.worst_reversal_mv?.toFixed(1))}`
                ).join(m.listSemi)}
              </p>
            )
          })()}

          {/* 快速檢驗的重點是數字：眼高眼寬是基準線，之後接上真實通道
              比的就是這一組。量測在 measurements.metrics 底下，外層是
              ADR-0039 的可得性包裝，取不到時要把原因印出來。 */}
          {quickMeasurements && quickMeasurements.available === false && (
            <p className="hint">
              {m.noMeasurements(pickText(quickMeasurements, 'unavailable_reason', lang))}</p>
          )}
          {quickMeasurements
            && Object.keys(quickMeasurements.metrics || {}).length > 0 && <>
            <h4>{m.baselineMeasurements}</h4>
            <table className="model-library__table eye-metrics">
              <thead><tr><th>{m.colMeasurement}</th><th>{m.colValue}</th></tr></thead>
              <tbody>{Object.entries(quickMeasurements.metrics)
                .map(([key, item]: [string, any]) => (
                  <tr key={key}>
                    <td>{pickText(item, 'label', lang) || key}</td>
                    <td>{item.value !== undefined
                      ? `${Number(item.value).toPrecision(4)} ${item.unit || ''}`
                      : pickText(item, 'text', lang)}</td>
                  </tr>
                ))}</tbody>
            </table>
          </>}

          </ResultDetailsDrawer>
        </section>}

      {/* 執行歷史。ADR-0016 的不可變紀錄一直只存在於後端，這是它的入口。
          一次求解要跑數十分鐘到數小時，能回頭比對的價值遠大於少一顆按鈕。 */}
      {/* 讀 `multi_lane` 種類的紀錄，不是點對點 IBIS 的。
          先前這裡讀的是 Touchstone 旁邊的 `ibis_channel_runs`——那些是
          **點對點通道**的紀錄，跟多道是不同的分析，列在這裡會讓人以為
          自己跑過但其實沒有。2026-08-31 多道開始寫自己的紀錄之後改掉。 */}
      <RunHistory kind="multi_lane" title={m.historyTitle} onRestore={restoreRun} />
    </div>
  )
}
