// 多埠通道：多道串擾分析與位元組通道（ADR-0044、ADR-0045、ADR-0046）。
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
import { useEffect, useMemo, useState } from 'react'
import type { ModelPackage } from './ModelLibrary'
import { useCascadedChannel } from './useCascadedChannel'

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
  touchstone: { path: string; n_ports: number; port_names: string[]; has_port_names: boolean }
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
  ready: boolean
}

type Disposition = { kind: 'terminate' | 'open' | 'ground'; impedance_ohm?: number; reference_volt?: number }

const EVIDENCE_LABEL: Record<string, string> = {
  high: '可整批確認',
  partial: '待逐一檢視',
  none: '必須人工指定',
}

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
function sideBlocker(item: ModelPackage, side: 'tx' | 'rx'): string {
  const caps = item.capabilities
  if (!caps) return ''
  if (side === 'tx' && caps.tx_models === 0) return '沒有驅動器模型'
  if (side === 'rx' && caps.rx_models === 0) return '沒有接收器模型'
  return ''
}

function packageLabel(item: ModelPackage, side: 'tx' | 'rx'): string {
  const blocker = sideBlocker(item, side)
  if (blocker) return `${item.display_name}（${blocker}）`
  const status = item.compatibility?.status
  if (status === 'block') return `${item.display_name}（有錯誤）`
  if (status === 'warning') return `${item.display_name}（有警告）`
  return item.display_name
}


export default function MultiLaneWizard(
  { packages, onLibraryChanged }:
  { packages: ModelPackage[]; onLibraryChanged?: () => void | Promise<void> },
) {
  const cascaded = useCascadedChannel()
  const [touchstone, setTouchstone] = useState('')
  const [packageId, setPackageId] = useState('')
  // 另一側的模型套件。DDR 的兩端永遠是控制器與顆粒兩家料號，只給一份會讓
  // 對側綁到同一顆模型——綁得上、是 high 證據、眼圖照畫，只是型號整組是反的。
  const [rxPackageId, setRxPackageId] = useState('')
  const [dataRate, setDataRate] = useState(1.6)
  // 驅動強度與 ODT 是**各元件自己的**暫存器設定，不是一組共用的數字。
  // 寫入用控制器的驅動強度配顆粒的 ODT；同一組值套到兩側，其中一側必然
  // 對不上——實測 48 Ω 是控制器的值，顆粒只有 34／40 Ω，於是顆粒側整批
  // 「找不到變體」，而 48 本身沒有錯。
  const [driveOhmBySide, setDriveOhmBySide] = useState<[string, string]>(['', ''])
  const [odtOhmBySide, setOdtOhmBySide] = useState<[string, string]>(['', ''])
  // DDR3 與 DDR3L 常同檔並存且 Z0 完全一樣，差別只在 VDDQ 是 1.5 V 還是
  // 1.35 V。選錯不會報錯，只會量到別人的板子。
  const [technology, setTechnology] = useState('')
  /** 選擇器 → 使用者親手指定的變體。工具說「需要人工判斷」時要有地方回答，
   *  否則那句話等於把按鈕永久鎖住（實測 PDIFF 有 17 個同阻值的候選）。 */
  const [variantPick, setVariantPick] = useState<Record<string, string>>({})
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
  const [laneCount, setLaneCount] = useState<number | null>(null)
  // 方向沒有預設值：雙向 I/O 的讀與寫都真實存在，替使用者選一個等於
  // 有一半的機率量到反方向的通道，而且沒有任何跡象（ADR-0049）。
  const [drivingSide, setDrivingSide] = useState<number | null>(null)
  const [dispositions, setDispositions] = useState<Record<number, Disposition>>({})
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [started, setStarted] = useState('')
  /** 快速檢驗的參考通道檔位（2026-08-29 下午）。 */
  const [lossyReference, setLossyReference] = useState(false)
  /** 快速檢驗（無損直連）這一輪的 job 與實際用到的兩顆模型。
   *  結果沿用同一個 /api/ibis-channel/status，靠 job_id 認出它是基準眼圖。 */
  const [quickCheck, setQuickCheck] = useState<
    { jobId: string; txModel: string; rxModel: string } | null>(null)

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
    setBusy(true); setError(''); setSuggestion(null); setStarted('')
    try {
      const body: Record<string, unknown> = {
        touchstone_path: touchstone, package_id: packageId,
        data_rate_gbps: dataRate, exploratory: true,
      }
      if (rxPackageId) body.rx_package_id = rxPackageId
      if (side !== null) body.driving_side = side
      body.ohms_by_side = [0, 1].map(side => ({
        drive_ohm: driveOhmBySide[side] ? Number(driveOhmBySide[side]) : null,
        odt_ohm: odtOhmBySide[side] ? Number(odtOhmBySide[side]) : null,
      }))
      if (technology) body.technology = technology
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
      if (!response.ok) throw new Error(data?.detail || '預檢失敗')
      setSuggestion(data as Suggestion)
      setLaneCount(null)
      setDispositions({})
      // portModels 不清：那是使用者填的，清掉等於每次重新預檢都要再填一次。
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally { setBusy(false) }
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
      if (bad.length) return { table: null, error: `不認得的項目：${bad.join('、')}` }
      for (const key of keys) {
        const rows = parsed[key]
        if (!Array.isArray(rows)) return { table: null, error: `${key} 要是陣列` }
        for (const row of rows) {
          if (typeof row?.slew_v_per_ns !== 'number'
            || typeof row?.adjust_ps !== 'number') {
            return { table: null, error: `${key} 每列都要有 slew_v_per_ns 與 adjust_ps` }
          }
        }
      }
      return { table: parsed, error: '' }
    } catch (exc) {
      return { table: null, error: exc instanceof Error ? exc.message : String(exc) }
    }
  }, [deratingText])

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
        name: `DDR 判讀準位（使用者提供）`,
        version: 'user',
        applicability: `${dataRate} Gbps`,
        source: '由使用者於介面填入',
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

  /** 挑一個多埠 Touchstone。
   *
   *  沿用 `/api/browse_touchstone`（外部檔案接線本來就在用），它是多選的，
   *  這裡只要一個就取第一個。按了取消會回空陣列——那不是錯誤，不要跳訊息。
   *
   *  換了檔案就把預檢結果清掉：那份結果是綁在上一個 Touchstone 的埠名與埠數
   *  上的，留著會讓人以為新檔案已經預檢過了。
   */
  async function browseTouchstone() {
    setBusy(true); setError('')
    try {
      const picked = await fetch('/api/browse_touchstone').then(r => r.json())
      const first: string = picked?.paths?.[0] || ''
      if (first) { setTouchstone(first); setSuggestion(null); setStarted('') }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally { setBusy(false) }
  }

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
        if (!response.ok) throw new Error(data?.detail || `匯入失敗：${path}`)
        lastId = data?.model?.package_id || lastId
      }
      await onLibraryChanged?.()
      if (lastId) (target === 'tx' ? setPackageId : setRxPackageId)(lastId)
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally { setBusy(false) }
  }

  /** 快速檢驗：TX 與 RX 背對背接無損參考通道，先看基準眼圖。
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
      if (!response.ok) throw new Error(data?.detail || '快速檢驗啟動失敗')
      setQuickCheck({
        jobId: data.job_id || '',
        txModel: data.quick_check?.tx_model || '',
        rxModel: data.quick_check?.rx_model || '',
      })
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally { setBusy(false) }
  }

  async function start(sweep = false) {
    if (!suggestion) return
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
        role: VariantChoice['role']): string => {
        if (portIndex === undefined) return ''
        const row = suggestion.binding.bindings[portIndex]
        if (!row?.model) return ''
        const match = suggestion.variant_choices.find(
          item => item.selector === row.model && item.role === role)
        return match ? pickedVariant(match) : ''
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
              tx_buffer: variantFor(oriented?.output_index, 'receiver'),
              rx_buffer: variantFor(oriented?.input_index, 'driver'),
            }
          })
        : []
      const reverse = driver && receiver && reverseLanes.length ? {
        mode: busMode === 'write' ? 'read' : 'write',
        driving_side: receiver.side,
        tx_buffer: pickedVariant(receiver),
        rx_buffer: pickedVariant(driver),
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
          dispositions: portsNeedingDisposition.map(item => ({
            port_index: item.index, ...(dispositions[item.index] || { kind: 'open' }),
          })),
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
      if (!response.ok) throw new Error(data?.detail || '啟動失敗')
      // 勾了雙向就是「方向 × Corner」。只印 Corner 數會與進度列的 [1/6]
      // 對不上——畫面上兩個數字互相矛盾時，看的人只會不信任兩個。
      const passes = corners.length * (sweep && bothDirections && reverse ? 2 : 1)
      setStarted(`已排入背景（job ${data.job_id ?? '—'}）。`
        + (sweep ? `共 ${passes} 組（${corners.length} 個 Corner`
            + (passes > corners.length ? ' × 2 個方向' : '') + '），依序執行。' : '')
        + '進度顯示在下方的「分析狀態與結果」。')
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    } finally { setBusy(false) }
  }

  const jobElapsed = job?.started_at
    ? Math.max(0, Math.round(((job.finished_at || Date.now() / 1000) - job.started_at)))
    : 0
  const jobResult = job?.status === 'done' ? job?.result : null
  const ranking = jobResult?.ranking || null
  const signalTables: any[] = jobResult?.sweep
    ? (jobResult.tables || [])
    : (jobResult?.signal_table ? [jobResult.signal_table] : [])
  const timingWhy = jobResult?.sweep
    ? (jobResult.runs?.[0]?.result?.timing?.why || '')
    : (jobResult?.timing?.why || '')
  const fmtPs = (value: unknown) =>
    typeof value === 'number' ? value.toFixed(1) : '—'
  /** 目前顯示的結果是不是快速檢驗那一輪（無損直連基準）。 */
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
        lanes: run?.result?.lanes || [], corner: run?.label || '' }))
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
          title: isQuickCheck ? '基準眼圖（無損直連）'
            : lane.label || `Lane ${laneIndex + 1}`,
          corner: isQuickCheck && quickCheck
            ? `${quickCheck.txModel} → ${quickCheck.rxModel}` : group.corner,
          imageUrl: `/api/ibis-channel/image?analysis_index=${analysisIndex}`
            + `&lane_index=${laneIndex}&image_index=${imageIndex}`,
        })
      })
    })
    return cards
  }, [jobResult, isQuickCheck, quickCheck])

  const missingDisposition = portsNeedingDisposition.filter(item => {
    const plan = dispositions[item.index]
    if (!plan) return true
    if (plan.kind !== 'terminate') return false
    return plan.impedance_ohm === undefined || plan.reference_volt === undefined
  })
  /** 這個選擇器這一輪實際會用到的那一欄。方向未定時兩欄都算。 */
  const usedRoles = (item: VariantChoice) =>
    item.role === 'driver' ? [item.tx]
      : item.role === 'receiver' ? [item.rx]
        : [item.tx, item.rx]
  /**
   * 人工覆寫的鍵要含**側**。兩份 `.ibs` 出自同一個系列時選擇器會同名
   * （Ansys 的控制器與顆粒兩邊都叫 `ansys_ddr4_dq`），只用名稱當鍵的話
   * 改控制器那一欄會連顆粒那一欄一起改掉，而畫面上兩欄都顯示成你選的值。
   */
  const variantKey = (item: VariantChoice) => `${item.side}:${item.selector}`
  /** 這個選擇器最後會用哪一個變體：人工指定優先，其次工具選的。 */
  const pickedVariant = (item: VariantChoice) =>
    variantPick[variantKey(item)] || usedRoles(item).find(r => r.selected)?.selected || ''
  const variantPending = (suggestion?.variant_choices ?? [])
    .some(item => usedRoles(item).some(role => role.requires_user)
      && !variantPick[variantKey(item)])
  const directionPending = Boolean(suggestion)
    && suggestion!.bus_direction.driving_side === null
  const canStart = Boolean(suggestion) && suggestion!.blockers.length === 0
    && missingDisposition.length === 0 && !variantPending && !directionPending && !busy

  return (
    <div className="ibis-wizard multi-lane-wizard">
      <section>
        <h3>選擇多埠 Touchstone 與 IBIS</h3>
        <p className="hint">
          8 埠以上的完整通道模型。位元組通道與多道串擾的數值不可互相比較。
        </p>
        <label>Touchstone 路徑
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input is-wide" value={touchstone}
              placeholder="path\to\channel.s16p"
              onChange={event => setTouchstone(event.target.value)} />
            <button className="btn" disabled={busy}
              onClick={() => void browseTouchstone()}>瀏覽…</button>
          </div>
        </label>
        {cascaded && <div className="ibis-wizard__from-cascade">
          <button className="btn"
            onClick={() => setTouchstone(cascaded.path)}>帶入串接結果</button>
          <code title={cascaded.path}>
            {cascaded.path.split(/[\\/]/).pop()}（{cascaded.n_ports} Port）
          </code>
        </div>}
        <label>IBIS 模型套件（驅動側）
          <select className="input" value={packageId}
            onChange={event => setPackageId(event.target.value)}>
            <option value="">請選擇…</option>
            {ibisPackages.map(item => (
              <option key={item.package_id} value={item.package_id}
                disabled={Boolean(sideBlocker(item, 'tx'))}>
                {packageLabel(item, 'tx')}
              </option>
            ))}
          </select>
        </label>
        {/* 兩顆按鈕的文字必須寫明是哪一側。它們寫的是不同的 state（packageId
            與 rxPackageId），按錯會把控制器的模型自動選進顆粒那一側——而眼圖
            照畫、預檢照過，不會有任何錯誤訊息。同名時輔助技術的按鈕清單裡也
            會出現兩個一模一樣的項目，完全分不出來。 */}
        <button className="btn" disabled={busy} onClick={() => void importIbis('tx')}>
          瀏覽並匯入驅動側 .ibs…
        </button>
        <label>另一側的模型套件
          <select className="input" value={rxPackageId}
            onChange={event => setRxPackageId(event.target.value)}>
            <option value="">同上（兩側同一料號）</option>
            {ibisPackages.map(item => (
              <option key={item.package_id} value={item.package_id}
                disabled={Boolean(sideBlocker(item, 'rx'))}>
                {packageLabel(item, 'rx')}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={busy} onClick={() => void importIbis('rx')}>
          瀏覽並匯入另一側 .ibs…
        </button>
        {/* 這裡只收 kind === 'ibis'。ADR-0055 收掉 AMI 面板之後，IBIS-AMI 套件
            在整個介面上已經沒有分析路徑——但模型庫照樣讓人匯入、掃描、信任。
            不講的話，使用者匯完 AMI 套件回到這一頁，只會看到選單裡沒有它。
            2026-08-24 實測：模型庫六個套件，兩個是 AMI，這一頁只看得到四個。 */}
        {ibisPackages.length === 0 && amiPackages.length > 0 && <p className="hint">
          這裡只吃一般 IBIS，AMI 目前沒有分析路徑。
        </p>}
        {ibisPackages.length === 0 && amiPackages.length === 0 && <p className="hint">
          模型庫是空的，用上面兩顆按鈕各挑一份 .ibs。
        </p>}
        {ibisPackages.length > 0 && amiPackages.length > 0 && <p className="hint">
          另有 {amiPackages.length} 個 AMI 套件，這裡用不到。
        </p>}
        <p className="hint">DDR 兩端是兩家料號，兩個都要選。</p>
        <label>資料率（Gbps）
          <input className="input" type="number" step="0.1" value={dataRate}
            onChange={event => setDataRate(Number(event.target.value))} />
        </label>
        <label>上升時間（ps）
          <input className="input" type="number" value={riseTimePs}
            placeholder={`留空＝取自 IBIS [Ramp]（通則 ${(200 / dataRate).toFixed(0)}）`}
            onChange={event => setRiseTimePs(event.target.value)} />
        </label>
        <p className="hint">留空即可，預檢完會顯示模型實際的邊緣。</p>
        <p className="hint">這個值不是餵給緩衝器的邊緣，那由 IBIS 決定。</p>
        <p className="hint">它只用來算拐點 0.5/Tr，決定頻寬夠不夠。</p>
        <button className="btn" disabled={!touchstone || !packageId || busy}
          onClick={() => void runSuggest()}>{busy ? '處理中…' : '執行預檢'}</button>
        {error && <p className="error">{error}</p>}
      </section>

      <section>
        <h3>快速檢驗：參考通道基準眼圖</h3>
        {/* 不接使用者通道：TX 與 RX 之間放的是工具自產的參考線——無損
            直連看模型本來的眼，有損檔位看典型中等損耗下還剩多少。
            模型由套件角色自動挑，不需要 Touchstone。 */}
        <p className="hint">把上面選的兩側模型背對背接上工具自產參考線。</p>
        <p className="hint">基準眼就不好＝模型或資料率的問題，跟通道無關。</p>
        <p className="hint">基準眼好、接上通道才壞＝通道的問題。</p>
        <label style={{ display: 'flex', flexDirection: 'row', gap: 6,
          alignItems: 'center' }}>
          <input type="checkbox" checked={lossyReference}
            style={{ width: 'auto' }}
            onChange={event => setLossyReference(event.target.checked)} />
          用有損參考通道（Nyquist −10 dB 趨膚模型；預設是無損直連）
        </label>
        <button className="btn" disabled={!packageId || busy || Boolean(job?.running)}
          onClick={() => void runQuickCheck()}>
          {busy ? '處理中…' : '快速檢驗（不需 Touchstone）'}
        </button>
        {quickCheck && <p className="hint">
          已排入背景：{quickCheck.txModel} → {quickCheck.rxModel}，
          結果顯示在下方「分析狀態與結果」。
        </p>}
      </section>

      {suggestion && <>
        <section>
          <h3>群組判定</h3>
          <p>
            <strong>{suggestion.analysis_kind === 'byte_lane' ? '位元組通道' : '多道串擾分析'}</strong>
            　{suggestion.binding.lanes.length} 條道
            　分側依據：{suggestion.binding.sides.basis}
            {suggestion.binding.sides.labels.length > 0 &&
              `（${suggestion.binding.sides.labels.map((label, index) => {
                const alias = suggestion.binding.sides.label_aliases?.[index] ?? []
                return alias.length > 0 ? `${label}＝${alias.join('＝')}` : label
              }).join(' ↔ ')}）`}
          </p>
          <p className="hint">{suggestion.group.why}</p>
          {/* 哪一份套件對到哪一側是推出來的：填反了不會報錯，只會讓眼圖
              用錯緩衝器，所以一定要顯示出來讓人核對。 */}
          {(suggestion.packages || []).length === 2 && <p className="hint">
            模型套件：
            {suggestion.packages.map(item => (
              <span key={item.side}>
                {item.side > 0 ? '　｜　' : ''}
                第 {item.side + 1} 側
                {suggestion.binding.sides.labels[item.side]
                  ? `（${suggestion.binding.sides.labels[item.side]}）` : ''}
                ＝ {item.display_name || '未指定'}
                {item.component ? `／${item.component}` : ''}
              </span>
            ))}
            {suggestion.two_package && suggestion.package_assignment?.swapped &&
              '　（依腳位號證據自動對調）'}
            {suggestion.two_package && suggestion.package_assignment?.tie &&
              '　（兩種對應同分，沿用填寫順序，請自行核對）'}
          </p>}
          {suggestion.group.strobe_pairs.map(pair => (
            <p key={pair.labels.join()} className="hint">
              選通：{pair.labels.join(' / ')}　腳位 {pair.pins.join(' / ')}
            </p>
          ))}
        </section>

        <section>
          <h3>匯流排方向</h3>
          {/* ADR-0049：方向決定哪一側接驅動緩衝器。接反了電路照樣解得動、
              眼圖照樣畫得出來，只是量到的是反方向的通道——沒有任何跡象。
              單向訊號由 Model_type 定死，不給選；雙向 I/O 必選，不給預設。 */}
          <p className="hint">{suggestion.bus_direction.reason}</p>
          {suggestion.bus_direction_applies ? <>
            <label>驅動側<span className="required">必填</span>
              <select className="input"
                value={suggestion.bus_direction.driving_side ?? ''}
                onChange={event => {
                  const value = event.target.value === '' ? null : Number(event.target.value)
                  setDrivingSide(value)
                  void runSuggest(value)
                }}>
                <option value="">請選擇…</option>
                {suggestion.bus_direction.sides
                  .filter(item => suggestion.bus_direction.feasible.includes(item.side))
                  .map(item => (
                    <option key={item.side} value={item.side}>
                      第 {item.side + 1} 側（{item.label}）驅動
                    </option>
                  ))}
              </select>
            </label>
          </> : (
            <p>
              驅動側：<strong>
                {suggestion.bus_direction.driving_side === null ? '未定案'
                  : `第 ${suggestion.bus_direction.driving_side + 1} 側（${
                    suggestion.bus_direction.sides[suggestion.bus_direction.driving_side].label}）`}
              </strong>
              {suggestion.bus_direction.basis === 'model_type' && '　由 IBIS 的 Model_type 定死'}
            </p>
          )}
          <table className="model-library__table">
            <thead><tr><th>側</th><th>Model_type</th><th>可驅動</th><th>可接收</th></tr></thead>
            <tbody>{suggestion.bus_direction.sides.map(item => (
              <tr key={item.side}>
                <td>第 {item.side + 1} 側（{item.label || '—'}）</td>
                <td>{item.model_types.join('、') || '—'}</td>
                <td>{item.can_drive ? '是' : '否'}</td>
                <td>{item.can_receive ? '是' : '否'}</td>
              </tr>
            ))}</tbody>
          </table>
          {suggestion.bus_direction.lanes.some(item => item.feasible.length === 0) &&
            <details open>
              <summary>
                擋住方向的道（{suggestion.bus_direction.lanes
                  .filter(item => item.feasible.length === 0).length} 條）
              </summary>
              {/* 位元組通道本來就會混著單向道與雙向道：DDR 的資料遮罩由控制器
                  單向驅動，記憶體端沒有它的驅動器。這不是檔案壞掉。 */}
              <table className="model-library__table">
                <thead><tr><th>道</th><th>兩側模型</th><th>原因</th></tr></thead>
                <tbody>{suggestion.bus_direction.lanes
                  .filter(item => item.feasible.length === 0).map(item => (
                    <tr key={item.label}>
                      <td>{item.label}</td>
                      <td>{item.models.map(name => name || '—').join(' ↔ ')}</td>
                      <td>{item.why}</td>
                    </tr>
                  ))}</tbody>
              </table>
              <p className="hint">
                把「要出眼圖的道數」調到不含這些道，就可以用
                {suggestion.bus_direction.feasible_without_blocking_lanes
                  .map(side => `第 ${side + 1} 側`).join(' 或 ') || '（沒有可行的方向）'}
                驅動繼續。
              </p>
            </details>}
          {suggestion.lane_orientation.length > 0 && <details>
            <summary>依此方向的逐道接法（{suggestion.lane_orientation.length} 條）</summary>
            <table className="model-library__table">
              <thead><tr><th>道</th><th>驅動端 Port</th><th>接收端 Port</th></tr></thead>
              <tbody>{suggestion.lane_orientation.map(item => (
                <tr key={item.label}>
                  <td>{item.label}</td><td>{item.input_port}</td><td>{item.output_port}</td>
                </tr>
              ))}</tbody>
            </table>
          </details>}
        </section>

        {suggestion.blockers.length > 0 && <section className="blockers">
          <h3>必須先解決</h3>
          <ul>{suggestion.blockers.map(text => <li key={text}>{text}</li>)}</ul>
        </section>}

        {suggestion.warnings.length > 0 && <section>
          <h3>提醒</h3>
          <ul>{suggestion.warnings.map(text => <li key={text}>{text}</li>)}</ul>
        </section>}

        <section>
          <h3>綁定證據</h3>
          {/* 分級整批確認：高證據的預先配好、一次確認；partial 必須逐一檢視。
              顯示的是「對上了幾個鍵」這種可稽核的證據，不是信心分數。 */}
          <p>
            {(['high', 'partial', 'none'] as const).map(level => (
              <span key={level} style={{ marginRight: '1.5em' }}>
                {EVIDENCE_LABEL[level]}：<strong>{suggestion.binding.evidence_counts[level] ?? 0}</strong> 個
              </span>
            ))}
          </p>
          {suggestion.binding.components.map((item, index) => item.ranking.length > 0 && (
            <details key={index}>
              <summary>
                第 {index + 1} 側元件：{item.selected || '（分數相同，未自動選定）'}
              </summary>
              <table className="model-library__table">
                <thead><tr><th>元件</th><th>兩鍵吻合</th><th>訊號唯一</th><th>依據</th></tr></thead>
                <tbody>{item.ranking.map(rank => (
                  <tr key={rank.component}>
                    <td>{rank.component}</td><td>{rank.two_key_ports}</td>
                    <td>{rank.unique_signal_ports}</td><td>{rank.basis}</td>
                  </tr>
                ))}</tbody>
              </table>
            </details>
          ))}
          <details>
            <summary>逐埠綁定（{suggestion.binding.bindings.length} 個 Port）</summary>
            <table className="model-library__table">
              <thead><tr><th>Port</th><th>側</th><th>腳位</th><th>訊號</th><th>模型</th><th>證據</th></tr></thead>
              <tbody>{suggestion.binding.bindings.map(row => (
                <tr key={row.port_index}>
                  <td>{row.port}</td><td>{row.side_label || '—'}</td>
                  <td>{row.pin || '—'}</td><td>{row.signal || '—'}</td>
                  <td>{row.model || '—'}</td>
                  <td>{EVIDENCE_LABEL[row.evidence]}
                    {row.keys.length > 0 && `（${row.keys.join('＋')}）`}</td>
                </tr>
              ))}</tbody>
            </table>
          </details>
        </section>

        <section>
          <h3>緩衝器變體</h3>
          {/* 速率等級與有無 ODT 可以推導；阻值是設計選擇，由控制器設定
              決定，工具沒有依據代選（ADR-0046）。**兩側各有自己的一組**：
              寫入用控制器的驅動強度配顆粒的 ODT。 */}
          <p className="hint">兩端各自一組：驅動強度與 ODT 是各元件的暫存器設定。</p>
          {[0, 1].map(side => {
            const label = suggestion.binding.sides.labels[side] || `第 ${side + 1} 側`
            const driving = suggestion.bus_direction.driving_side === side
            return (
              <div key={side} className="field-row">
                <strong style={{ minWidth: '9em' }}>
                  {label}{driving ? '（本次驅動）' : '（本次接收）'}
                </strong>
                <label>驅動阻抗（Ω）
                  <input className="input" type="number"
                    value={driveOhmBySide[side]}
                    onChange={e => setDriveOhmBySide(prev => {
                      const next = [...prev] as [string, string]
                      next[side] = e.target.value
                      return next
                    })} />
                </label>
                <label>ODT（Ω）
                  <input className="input" type="number" value={odtOhmBySide[side]}
                    onChange={e => setOdtOhmBySide(prev => {
                      const next = [...prev] as [string, string]
                      next[side] = e.target.value
                      return next
                    })} />
                </label>
              </div>
            )
          })}
          <label>世代（同檔有 DDR3 與 DDR3L 時才需要）
            <select className="input" value={technology}
              onChange={e => setTechnology(e.target.value)}>
              <option value="">不篩選</option>
              {['DDR3', 'DDR3L', 'DDR4', 'DDR5', 'LPDDR3', 'LPDDR4', 'LPDDR5']
                .map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <p className="hint">DDR3 與 DDR3L 的 Z0 一樣，差在 VDDQ。選錯不會報錯。</p>
          <button className="btn" disabled={busy} onClick={() => void runSuggest()}>
            套用並重新推導變體
          </button>
          {suggestion.bandwidth && <p className="hint">
            邊緣 {suggestion.bandwidth.rise_time_ps.toFixed(0)} ps
            → 可用頻寬 {suggestion.bandwidth.usable_bandwidth_ghz.toFixed(2)} GHz、
            建議掃到 {suggestion.bandwidth.sweep_max_ghz.toFixed(2)} GHz
          </p>}
          {suggestion.variant_choices.map(choice => {
            // 方向定案後只顯示這一輪用得到的那一欄。兩欄都印會讓人去解一個
            // 這次用不到的問題——實測就是這樣卡住的。
            type Row = [string, VariantChoice['tx']]
            const rows: Row[] = choice.role === 'driver' ? [['驅動', choice.tx]]
              : choice.role === 'receiver' ? [['接收', choice.rx]]
                : [['驅動', choice.tx], ['接收', choice.rx]]
            return (
              // React 的 key 也要含側：同一個系列的兩份 `.ibs` 選擇器同名，
              // 只用名稱當 key 會讓 React 把兩張卡片當成同一張。
              <div key={variantKey(choice)}>
                <h4>
                  {choice.selector}（{choice.variants.length} 個變體）
                  {choice.component && `　${choice.component}`}
                  {choice.role !== 'unknown' &&
                    `　本次為${choice.role === 'driver' ? '驅動' : '接收'}側`}
                </h4>
                {rows.map(([name, item]) => (
                  <p key={name}>
                    {name}：{item.selected || <em>{item.reason}</em>}
                    {item.selected && item.rate_checked === false &&
                      <span className="hint">　（描述無速率等級，這項未查）</span>}
                  </p>
                ))}
                {/* 工具說「需要人工判斷」時，這裡就是判斷的地方。
                    沒有這一格的話那句話等於把按鈕永久鎖住。 */}
                {usedRoles(choice).some(role => role.requires_user) && (() => {
                  const candidates = usedRoles(choice)
                    .flatMap(role => role.candidates)
                  const unique = Array.from(new Set(candidates))
                  return (
                    <label>由你指定（{unique.length} 個候選）
                      <select className="input"
                        value={variantPick[variantKey(choice)] || ''}
                        onChange={e => setVariantPick(prev => ({
                          ...prev, [variantKey(choice)]: e.target.value,
                        }))}>
                        <option value="">（未指定，無法送出）</option>
                        {unique.map(name => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                  )
                })()}
              </div>
            )
          })}
        </section>

        <section>
          <h3>分析範圍與碼型</h3>
          <label>要出眼圖的道數（其餘 Port 需指定處置）
            <input className="input" type="number" min={1} max={lanes.length}
              value={selectedLanes}
              onChange={event => setLaneCount(Number(event.target.value))} />
          </label>
          <label>碼型
            <select className="input" value={patternKind}
              disabled={bothPatterns}
              onChange={event => setPatternKind(event.target.value as 'worst_case' | 'prbs')}>
              <option value="worst_case">決定性最差（建議）</option>
              <option value="prbs">隨機 PRBS</option>
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={bothPatterns}
              onChange={event => setBothPatterns(event.target.checked)} />
            串擾與時序各跑一次（Corner 掃描才有效）
          </label>
          {bothPatterns && <>
            <p className="hint">最差碼型看串擾、PRBS 量 Setup／Hold。</p>
            <p className="hint">兩者不可互換，一份完整報告兩個都要。</p>
            <p className="hint">兩種碼型分開排名，不會混在一起比。</p>
          </>}
          {patternKind === 'worst_case' ? <>
            <label>翻轉前保持的 UI 數
              <input className="input" type="number" min={1} value={settleUi}
                onChange={event => setSettleUi(Number(event.target.value))} />
            </label>
            <p className="hint">
              共 {selectedLanes * 2 * 2 * settleUi} 個 UI。每條道各有一個 UI
              是全部鄰居同時反向切換——**必然發生**，不是期望。
            </p>
          </> : <>
            <label>暫態 UI 數
              <input className="input" type="number" min={1} value={transientUi}
                onChange={event => setTransientUi(Number(event.target.value))} />
            </label>
            {/* ADR-0045：隨機碼型的涵蓋率必須顯示，否則使用者會把
                「沒看到最差」誤讀成「沒有問題」。 */}
            <p className="warning">
              此設定下最差對齊的期望出現次數：
              <strong>{worstCaseExpectation(selectedLanes, transientUi).toFixed(4)}</strong>
              　（{selectedLanes - 1} 條攻擊者）。
              遠小於 1 代表這次沒看到最差串擾，<b>不得標示為最差情況</b>。
            </p>
          </>}
        </section>

        {portsNeedingModel.length > 0 && <section>
          <h3>模型檔裡沒有這根腳的 Port（{portsNeedingModel.length} 個）</h3>
          <p className="hint">
            另一端已經綁到模型，所以確定是訊號路徑。
          </p>
          <p className="hint">
            缺的是這一側 IBIS 沒有對應腳位。
          </p>
          <p className="hint">
            終結掉等於把真實訊號當廢埠，會低估串擾。
          </p>
          <p className="hint">
            這就是 DDR Wizard 用 Net Group 指派模型在做的事。
          </p>
          <p className="hint">
            例如 DDR 的 DM 併進 DQ 群。指定完請重新預檢。
          </p>
          <table className="model-library__table">
            <thead><tr><th>Port</th><th>用哪顆緩衝器</th></tr></thead>
            <tbody>{portsNeedingModel.map(item => (
              <tr key={item.index}>
                <td>{item.name}</td>
                <td>
                  <select className="input" aria-label={`${item.name} 要用哪顆緩衝器`}
                    value={portModels[item.index] ?? ''}
                    onChange={event => setPortModels(previous => {
                      const next = { ...previous }
                      if (event.target.value) next[item.index] = event.target.value
                      else delete next[item.index]
                      return next
                    })}>
                    <option value="">（未指定）</option>
                    {bufferChoices.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {Object.keys(portModels).length > 0 && <p className="hint">
            已指定 {Object.keys(portModels).length} 個，按上方的預檢按鈕重新推導。
          </p>}
        </section>}

        {portsNeedingDisposition.length > 0 && <section>
          <h3>未接緩衝器的 Port（{portsNeedingDisposition.length} 個）</h3>
          {/* 留著不接等於默默選了開路，而開路與終結給出不同的串擾結果——
              實測差 3.7 mV 峰值。兩者都不是安全預設（ADR-0046）。 */}
          <p className="hint">
            留著不接等於默默選了開路，必須明確指定。DDR 的終端是 ODT 對 VTT，不是
            阻值對地。
          </p>
          <table className="model-library__table">
            <thead><tr><th>Port</th><th>處置</th><th>阻值（Ω）</th><th>參考電壓（V）</th></tr></thead>
            <tbody>{portsNeedingDisposition.map(item => {
              const plan = dispositions[item.index]
              return (
                <tr key={item.index}>
                  <td>{item.name}</td>
                  <td>
                    <select className="input" aria-label={`${item.name} 的處置方式`}
                      value={plan?.kind ?? ''}
                      onChange={event => setDispositions(previous => ({
                        ...previous,
                        [item.index]: { kind: event.target.value as Disposition['kind'] },
                      }))}>
                      <option value="">請選擇…</option>
                      <option value="terminate">終結</option>
                      <option value="open">開路</option>
                      <option value="ground">接地</option>
                    </select>
                  </td>
                  <td>{plan?.kind === 'terminate' && (
                    <input className="input" type="number" aria-label={`${item.name} 的終結阻抗（Ω）`}
                      value={plan.impedance_ohm ?? ''}
                      onChange={event => setDispositions(previous => ({
                        ...previous,
                        [item.index]: { ...plan, impedance_ohm: Number(event.target.value) },
                      }))} />
                  )}</td>
                  <td>{plan?.kind === 'terminate' && (
                    <input className="input" type="number" step="0.01"
                      aria-label={`${item.name} 的終結參考電壓（V）`}
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
            還有 {missingDisposition.length} 個 Port 的處置未填完整。
          </p>}
        </section>}

        {suggestion.quality.executed && <section>
          <h3>通道模型預檢</h3>
          {/* 分兩層顯示：檔案固有的性質與這次激勵是否充分是兩件事，
              合併成一個通過與否會讓人把「這次夠用」誤讀成「這個檔案沒問題」
              （ADR-0048）。 */}
          {suggestion.quality.intrinsic && <>
            <h4>檔案固有</h4>
            <p>被動性（最大奇異值）：{suggestion.quality.intrinsic.passivity_max_singular_value}</p>
            <p>因果性（前置能量占比，逐道取最差）：
              {suggestion.quality.intrinsic.causality_precursor_energy_ratio ?? '量不出來'}
              　共 {suggestion.quality.intrinsic.causality_per_path.length} 條道</p>
          </>}
          <h4>這次激勵是否充分</h4>
          <table className="model-library__table">
            <thead><tr><th>項目</th><th>數值</th><th>門檻</th><th>判定</th></tr></thead>
            <tbody>{(suggestion.quality.checks ?? [])
              .filter(row => ['bandwidth', 'frequency_resolution', 'dc_extrapolation'].includes(row.check))
              .map(row => (
                <tr key={row.check}>
                  <td>{row.label}</td><td>{row.value ?? '—'}</td><td>{row.limit}</td>
                  <td>{row.status === 'pass' ? '通過' : row.status === 'fail' ? '未達' : '量不出來'}</td>
                </tr>
              ))}</tbody>
          </table>
        </section>}

        {/* 沒有選通就沒有時序裕度這個量（ADR-0044），所以整段跟著選通出現。 */}
        {strobePair && <section>
          <h3>DDR 時序裕度</h3>
          <label>
            <input type="checkbox" checked={measureTiming}
              onChange={e => setMeasureTiming(e.target.checked)} />
            　以選通為時間基準量 Setup／Hold
          </label>
          <p className="hint">選通：{strobePair.labels.join(' / ')}</p>
          <p className="hint">不勾只出眼圖，量到的是串擾劣化不是裕度。</p>

          {measureTiming && <>
            <label>方向
              <select className="input" value={busMode}
                onChange={e => setBusMode(e.target.value as 'write' | 'read')}>
                <option value="write">寫入（控制器→顆粒）</option>
                <option value="read">讀取（顆粒→控制器）</option>
              </select>
            </label>
            <p className="hint">
              選通相位 {strobePhaseUi} UI，由方向決定，不必自己填。
            </p>
            <p className="hint">寫入時 DQS 對齊在資料眼中央；讀取是邊緣對齊。</p>

            <h4>判讀準位</h4>
            <div className="field-row">
              <label>VDDQ（V）
                <input className="input" type="number" step="0.01" value={vddq}
                  onChange={e => setVddq(e.target.value)} />
              </label>
              <label>AC 偏移（V）
                <input className="input" type="number" step="0.005" value={acOffset}
                  onChange={e => setAcOffset(e.target.value)} />
              </label>
              <label>DC 偏移（V）
                <input className="input" type="number" step="0.005" value={dcOffset}
                  onChange={e => setDcOffset(e.target.value)} />
              </label>
            </div>
            <p className="hint">
              Vref ＝ {Number.isFinite(vref) ? vref.toFixed(3) : '—'} V；
              AC {thresholds.vih_ac.toFixed(3)}／{thresholds.vil_ac.toFixed(3)}、
              DC {thresholds.vih_dc.toFixed(3)}／{thresholds.vil_dc.toFixed(3)} V
            </p>
            <p className="hint">AC 嚴、DC 鬆，兩組門檻不同不是筆誤。</p>

            <h4>規格要求（選填）</h4>
            <div className="field-row">
              <label>tDS（ps）
                <input className="input" type="number" value={tds}
                  onChange={e => setTds(e.target.value)} />
              </label>
              <label>tDH（ps）
                <input className="input" type="number" value={tdh}
                  onChange={e => setTdh(e.target.value)} />
              </label>
            </div>
            <p className="hint">裕度 ＝ 量到的時間 − 這裡的要求 − derating。</p>
            <p className="hint">兩個都留空＝只出時間，不判 Pass／Fail。</p>
            <p className="hint">工具不內建 JEDEC 數值（ADR-0015），請自行填。</p>

            <div className="field-row">
              <label>Rx 遮罩寬（UI）
                <input className="input" type="number" step="0.01" value={maskUi}
                  onChange={e => setMaskUi(e.target.value)} />
              </label>
              <label>Rx 遮罩高（mV）
                <input className="input" type="number" value={maskMv}
                  onChange={e => setMaskMv(e.target.value)} />
              </label>
            </div>
            <p className="hint">DDR4 資料群的判準是遮罩，不是 setup／hold。</p>
            <p className="hint">位址命令群沒有跟著改，仍然是 setup／hold。</p>
            <p className="hint">暫態眼圖到不了 BER 1e-16，通過只是必要條件。</p>

            <label>Derating 表（選填，貼 JSON）
              <textarea className="input" rows={4} value={deratingText}
                placeholder={'{"tds_ps":[{"slew_v_per_ns":1.0,"adjust_ps":125},'
                  + '{"slew_v_per_ns":4.0,"adjust_ps":0}]}'}
                onChange={e => setDeratingText(e.target.value)} />
            </label>
            <p className="hint">base 值假設某個邊緣斜率，慢邊緣要求會變嚴。</p>
            <p className="hint">沒有表＝用 base 值，可能高估裕度。</p>
            <p className="hint">逐個選通邊各自查表，取最差的那一個。</p>
            {derating.error && <p className="warning">
              Derating 表讀不進來：{derating.error}
            </p>}
            {derating.table !== null && !derating.error && <p className="hint">
              已讀入 {Object.keys(derating.table as object).join('、')}。
            </p>}
          </>}
        </section>}

        <section>
          <h3>送出分析</h3>
          <button className="btn" disabled={!canStart} onClick={() => void start(false)}>
            {busy ? '處理中…' : '開始多道分析'}
          </button>

          {/* 最差條件由結果排序得出，不預先假設 Slow 最差（ADR-0011）。 */}
          <h4>或一次跑多個 Corner</h4>
          <div className="field-row">
            {[['typ', 'Typical'], ['min', 'Slow'], ['max', 'Fast']].map(([code, label]) => (
              <label key={code}>
                <input type="checkbox" checked={corners.includes(code)}
                  onChange={e => setCorners(prev => e.target.checked
                    ? [...prev, code] : prev.filter(c => c !== code))} />
                　{label}
              </label>
            ))}
          </div>
          <label>
            <input type="checkbox" checked={bothDirections}
              onChange={e => setBothDirections(e.target.checked)} />
            　同時跑讀取與寫入（兩張眼圖都真實存在而且不同）
          </label>
          {bothDirections && reverseOnlyDropped.length > 0 && <p className="hint">
            反方向少跑 {reverseOnlyDropped.join('、')}：那一側沒有驅動器。
          </p>}
          <button className="btn" disabled={!canStart || corners.length === 0}
            onClick={() => void start(true)}>
            {busy ? '處理中…'
              : `掃描 ${corners.length * (bothDirections ? 2 : 1)} 組`}
          </button>
          <p className="hint">只有 IBIS Corner 不同，其餘設定完全相同。</p>
          <p className="hint">最差條件由結果排序得出，不假設 Slow 最差。</p>
          {!canStart && !busy && <p className="hint">
            {suggestion.blockers.length > 0 ? '請先解決上方的阻擋項目。'
              : directionPending ? '請先指定由哪一側驅動。'
                : variantPending ? '有選擇器還沒定案：填好兩側阻值重新推導，或在該欄自行指定。'
                  : missingDisposition.length > 0 ? '請把未接 Port 的處置填完整。' : ''}
          </p>}
          {started && <p>{started}</p>}
        </section>

      </>}

      {(job && job.status !== "idle") && <section>
        <h3>分析狀態與結果</h3>
          <div className={`ibis-wizard__job is-${job?.status || 'idle'}`}>
            <div><strong>{job?.phase || '尚未執行'}</strong><span>{job?.message}</span></div>
            <div>狀態：{job?.status || 'idle'}　·　耗時 {jobElapsed} 秒
              　·　Job {job?.job_id || '—'}</div>
          </div>
          {job?.error && <div className="model-library__issue is-error">
            失敗：{job.error}</div>}

          {/* 執行警告要跟著結果一起看——特別是「帶錯誤放行」：這份眼圖
              是帶著相容性錯誤跑出來的，判讀時要對照原話。 */}
          {(jobResult?.warnings?.length ?? 0) > 0 && (
            <details open={jobResult.warnings.some((w: string) => w.includes('放行'))}>
              <summary>執行警告（{jobResult.warnings.length} 則）</summary>
              <ul>{jobResult.warnings.map((w: string) => (
                <li key={w} className="hint">{w}</li>
              ))}</ul>
            </details>
          )}

          {/* Corner 掃描：先給排序表——看的人第一個問題是「哪個最差」。 */}
          {ranking?.ranked?.length > 0 && <>
            <h4>Corner 排序（最差在最上面）</h4>
            <table className="model-library__table">
              <thead><tr><th>Corner</th><th>最差 Setup 裕度 (ps)</th>
                <th>最差訊號</th><th>判定</th></tr></thead>
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
            <p className="hint">最差條件由結果排序得出，不假設 Slow 最差。</p>
          </>}

          {signalTables.map((table: any, index: number) => (
            <div key={index}>
              <h4>逐訊號裕度{table.corner ? `　${table.corner}` : ''}</h4>
              <table className="model-library__table">
                <thead><tr><th>訊號</th><th>驅動腳</th><th>接收腳</th>
                  <th>Setup (ps)</th><th>Hold (ps)</th><th>tVAC (ps)</th>
                  <th>約束邊</th><th>判定</th></tr></thead>
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

          {/* 快速檢驗的重點是數字：眼高眼寬是基準線，之後接上真實通道
              比的就是這一組。量測在 measurements.metrics 底下，外層是
              ADR-0039 的可得性包裝，取不到時要把原因印出來。 */}
          {quickMeasurements && quickMeasurements.available === false && (
            <p className="hint">
              取不到眼圖量測：{quickMeasurements.unavailable_reason}
            </p>
          )}
          {quickMeasurements
            && Object.keys(quickMeasurements.metrics || {}).length > 0 && <>
            <h4>基準眼圖量測（無損直連）</h4>
            <table className="model-library__table">
              <thead><tr><th>量測</th><th>數值</th></tr></thead>
              <tbody>{Object.entries(quickMeasurements.metrics)
                .map(([key, item]: [string, any]) => (
                  <tr key={key}>
                    <td>{item.label || key}</td>
                    <td>{item.value !== undefined
                      ? `${Number(item.value).toPrecision(4)} ${item.unit || ''}`
                      : item.text}</td>
                  </tr>
                ))}</tbody>
            </table>
          </>}

          {eyeCards.length > 0 && <>
            <h4>眼圖（{eyeCards.length} 張）</h4>
            <div className="ibis-eye-gallery">
              {eyeCards.map(card => (
                <article key={card.key}
                  data-report-separate-snapshot="true"
                  data-report-kind={`multilane-${card.key}`}
                  data-report-title={`多埠眼圖：${card.title}`}>
                  <header><div><strong>{card.title}</strong>
                    <span>{card.corner}</span></div></header>
                  <img src={card.imageUrl} alt={`${card.title} 眼圖`} />
                </article>
              ))}
            </div>
          </>}
        </section>}
    </div>
  )
}
