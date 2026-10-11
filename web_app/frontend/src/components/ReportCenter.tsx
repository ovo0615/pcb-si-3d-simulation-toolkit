// 一鍵 HTML 報告中心：快照、品牌、章節、規格、浮水印與輸出。
import { useEffect, useMemo, useState } from 'react'

import { errorText } from '../backendFields'
import { useT } from '../i18n'
import {
  activateReportSnapshot,
  createReportSnapshot,
  fileToDataUrl,
  generateHtmlReport,
  loadReportWorkspace,
  openLatestReport,
  openReportWorkspace,
  saveReportBrand,
  saveReportSettings,
  snapshotImageUrl,
  updateReportSnapshot,
} from '../reportApi'
import {
  chosenReportLocale,
  effectiveReportLocale,
  localeMismatchCount,
  rememberReportLocale,
} from '../reportLocale'
import {
  DEFAULT_REPORT_SETTINGS,
  DEFAULT_WATERMARK,
  REPORT_SECTION_ORDER,
  reportSectionLabel,
  type ReportBrand,
  type ReportManifest,
  type ReportSettings,
  type ReportSnapshot,
  type SnapshotStatus,
  type WatermarkSettings,
} from '../reportTypes'
import '../report.css'

interface Props {
  basePath: string
  projectName: string
  onWorkspaceChange?: (workspace: string) => void
  /** 這份報告所依據的通道 Touchstone。給了報告才會有「模型品質與判定依據」
   *  一節；沒有串接結果時是空字串，那一節就不會出現。 */
  channelTouchstone?: string
}

type ReportTab = 'snapshots' | 'brand' | 'content' | 'watermark' | 'export'
interface WatermarkTemplate { name: string; settings: WatermarkSettings; imageDataUrl?: string }
const WATERMARK_TEMPLATE_KEY = 'pcbsi.report.watermarkTemplates.v1'

function loadWatermarkTemplates(): WatermarkTemplate[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WATERMARK_TEMPLATE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const EMPTY_BRAND: ReportBrand = {
  company_name: '', department: '', project_name: '', customer_name: '',
  report_number: '', logo_file: '',
}

const STATUS_ORDER: SnapshotStatus[] = ['pass', 'attention', 'fail', 'display']
const REPORT_TABS: ReportTab[] = ['snapshots', 'brand', 'content', 'watermark', 'export']

function normalizedSettings(value: Partial<ReportSettings> | undefined): ReportSettings {
  return {
    ...DEFAULT_REPORT_SETTINGS,
    ...(value || {}),
    // `null`／缺欄位＝沒設定過，塞回預設清單；`[]`＝使用者明確一節都不要。
    // 後端（reporting.py，manifest schema 2）對新工作區寫 `"sections": null`，
    // 舊工作區的 `[]` 會在讀取時翻成 `null`，而明確的 `[]` 產出的報告就是
    // 沒有選配章節——所以這裡必須用 `??`，不能用長度判斷，否則「全部取消」
    // 會被塞回全選。
    sections: value?.sections ?? REPORT_SECTION_ORDER,
    acceptance_criteria: value?.acceptance_criteria || {},
    watermark: { ...DEFAULT_WATERMARK, ...(value?.watermark || {}) },
  }
}

export default function ReportCenter({ basePath, projectName, onWorkspaceChange, channelTouchstone }: Props) {
  const { t, lang } = useT()
  const r = t.report
  const why = (error: unknown) => errorText(error, lang)
  const [tab, setTab] = useState<ReportTab>('snapshots')
  const [workspaceInput, setWorkspaceInput] = useState(basePath)
  const [workspace, setWorkspace] = useState('')
  const [manifest, setManifest] = useState<ReportManifest | null>(null)
  const [brand, setBrand] = useState<ReportBrand>({ ...EMPTY_BRAND, project_name: projectName })
  const [settings, setSettings] = useState<ReportSettings>(
    () => ({ ...DEFAULT_REPORT_SETTINGS, locale: effectiveReportLocale(lang) }))
  const [logoDataUrl, setLogoDataUrl] = useState('')
  const [watermarkDataUrl, setWatermarkDataUrl] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessageState] = useState<{ text: string; error: boolean }>({ text: '', error: false })
  // 紅字由呼叫端表明（setFailure），不再看訊息裡有沒有「失敗」——切到英文後那個字就不在了。
  const setMessage = (text: string) => setMessageState({ text, error: false })
  const setFailure = (text: string) => setMessageState({ text, error: true })
  const [lastOutput, setLastOutput] = useState('')
  const [watermarkTemplates, setWatermarkTemplates] = useState<WatermarkTemplate[]>(loadWatermarkTemplates)
  const [selectedWatermarkTemplate, setSelectedWatermarkTemplate] = useState('')
  const defaultProject = projectName || r.defaultProject

  /** 工作區存的設定；報告語言不取 manifest 的（分不出是選的還是出廠預設），
   *  一律「選過就照選的，否則跟介面語言」（卡 0087）。 */
  const applySettings = (value: Partial<ReportSettings> | undefined) =>
    setSettings({ ...normalizedSettings(value), locale: effectiveReportLocale(lang) })

  // 沒選過報告語言時，切換介面語言就跟著換。
  useEffect(() => {
    if (!chosenReportLocale()) setSettings(current => ({ ...current, locale: lang }))
  }, [lang])

  const refresh = async (target = workspace) => {
    if (!target) return
    const result = await loadReportWorkspace(target)
    setWorkspace(result.workspace)
    setManifest(result.manifest)
    setBrand({ ...EMPTY_BRAND, ...result.brand_profile, ...result.manifest.brand })
    if (result.brand_profile.logo_data_url && !result.manifest.brand.logo_file) {
      setLogoDataUrl(result.brand_profile.logo_data_url)
    }
    applySettings(result.manifest.settings)
    onWorkspaceChange?.(result.workspace)
  }

  /** 手動切換到別的工作區。留空＝回到預設目錄。 */
  const openWorkspace = async () => {
    setBusy(true)
    try {
      const result = await openReportWorkspace(workspaceInput, defaultProject)
      setWorkspace(result.workspace)
      setManifest(result.manifest)
      setBrand({ ...EMPTY_BRAND, ...result.brand_profile, ...result.manifest.brand })
      if (result.brand_profile.logo_data_url && !result.manifest.brand.logo_file) {
        setLogoDataUrl(result.brand_profile.logo_data_url)
      }
      applySettings(result.manifest.settings)
      setMessage(r.workspaceOpened(result.workspace))
      onWorkspaceChange?.(result.workspace)
    } catch (error) {
      setFailure(r.openWorkspaceFailed(why(error)))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!workspace) {
      // basePath 為空也要開：只載入一個外部 .sNp 來看曲線時，分段輸出、裁切
      // 輸出、輸入檔全都是空的，但那時候一樣會想存快照。後端收到空字串會退到
      // 預設目錄（Documents/PCB_SI_報告），使用者不必自己指定。
      if (basePath) setWorkspaceInput(basePath)
      void openReportWorkspace(basePath, defaultProject).then(result => {
        setWorkspace(result.workspace)
        setManifest(result.manifest)
        setBrand({ ...EMPTY_BRAND, ...result.brand_profile, ...result.manifest.brand })
        if (result.brand_profile.logo_data_url && !result.manifest.brand.logo_file) {
          setLogoDataUrl(result.brand_profile.logo_data_url)
        }
        applySettings(result.manifest.settings)
        setWorkspaceInput(result.workspace)
        onWorkspaceChange?.(result.workspace)
      }).catch(error => {
        // 吞掉的話畫面只會寫「工作區：尚未開啟」，一個字都不說為什麼；
        // 而且 `workspace` 一直是空的，App 每次重繪都會再 POST 一次。
        setFailure(r.openWorkspaceFailed(why(error)))
      })
    }
    // `onWorkspaceChange` 在 App 那邊每次 render 都是新的函式（沒有包
    // useCallback，見 Handoff），列進相依會讓這個 effect 一直重跑。開工作區
    // 只跟 basePath／projectName／是否已開有關。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, projectName, workspace])

  useEffect(() => {
    const listener = (event: Event) => {
      const custom = event as CustomEvent<{ workspace?: string }>
      if (custom.detail?.workspace) void refresh(custom.detail.workspace)
    }
    window.addEventListener('pcbsi-report-snapshot-saved', listener)
    return () => window.removeEventListener('pcbsi-report-snapshot-saved', listener)
  })

  const groups = useMemo(() => {
    const result = new Map<string, ReportSnapshot[]>()
    for (const snapshot of manifest?.snapshots || []) {
      const rows = result.get(snapshot.kind) || []
      rows.push(snapshot)
      result.set(snapshot.kind, rows.sort((a, b) => b.version - a.version))
    }
    return [...result.entries()]
  }, [manifest])

  const activeSnapshots = useMemo(
    () => (manifest?.snapshots || []).filter(item => item.active && item.selected),
    [manifest],
  )
  const staleCount = activeSnapshots.filter(item => item.stale).length
  // 截圖拍的是當下介面語言：和報告語言不同時，產生前就先提醒（後端產生時也會再算一次）。
  const mismatchCount = localeMismatchCount(activeSnapshots, settings.locale)

  const patchSnapshot = async (
    snapshot: ReportSnapshot,
    changes: Partial<Pick<ReportSnapshot, 'caption' | 'engineering_status' | 'section' | 'selected'>>,
  ) => {
    if (!workspace) return
    try {
      await updateReportSnapshot(workspace, snapshot.id, changes)
      await refresh()
    } catch (error) {
      setFailure(r.updateSnapshotFailed(why(error)))
    }
  }

  const openLatest = async () => {
    if (!workspace) return
    try {
      const result = await openLatestReport(workspace)
      setMessage(r.openedReport(result.opened))
    } catch (error) {
      setFailure(r.openLatestFailed(why(error)))
    }
  }

  // 這兩個都是 `void …(…)` 叫的，沒有 catch 就等於「按了什麼都沒發生」：
  // 12 MB 的截圖被後端以 400 擋掉、manifest 讀不到、版本數滿了回 409——
  // 使用者只會看到對話框關掉、畫面沒變，錯誤躺在主控台裡。與 patchSnapshot
  // 同一套 try/catch → setMessage。
  const useVersion = async (snapshot: ReportSnapshot) => {
    if (!workspace) return
    try {
      await activateReportSnapshot(workspace, snapshot.id)
      await refresh()
    } catch (error) {
      setFailure(r.activateFailed(why(error)))
    }
  }

  const uploadExternal = async (file: File | undefined) => {
    if (!file || !workspace) return
    try {
      const caption = window.prompt(r.externalCaptionPrompt, file.name) ?? ''
      const dataUrl = await fileToDataUrl(file)
      const payload = {
        workspace, kind: `external-${Date.now()}`, title: file.name,
        image_data_url: dataUrl, caption, engineering_status: 'display' as const,
        section: 'external', external: true,
      }
      try {
        await createReportSnapshot(payload)
      } catch (error) {
        // 409＝版本數已滿。與快照按鈕一樣，問過使用者才刪最舊的那一版。
        const typed = error as Error & { status?: number }
        if (typed.status !== 409
          || !window.confirm(r.pruneConfirm(why(error)))) throw error
        await createReportSnapshot({ ...payload, prune_confirmed: true })
      }
      await refresh()
      setMessage(r.externalAdded(file.name))
    } catch (error) {
      setFailure(r.externalFailed(why(error)))
    }
  }

  const saveBrand = async () => {
    if (!workspace) return
    setBusy(true)
    try {
      await saveReportBrand(workspace, brand, logoDataUrl, true)
      await refresh()
      setLogoDataUrl('')
      setMessage(r.brandSaved)
    } catch (error) {
      setFailure(r.saveBrandFailed(why(error)))
    } finally {
      setBusy(false)
    }
  }

  const saveAllSettings = async (): Promise<ReportSettings> => {
    if (!workspace) throw new Error(r.openWorkspaceFirst)
    const next = {
      ...settings,
      watermark: {
        ...settings.watermark,
        ...(watermarkDataUrl ? { image_data_url: watermarkDataUrl } : {}),
      },
    }
    const response = await saveReportSettings(workspace, next)
    const saved = normalizedSettings(response.settings)
    setSettings(saved)
    setWatermarkDataUrl('')
    return saved
  }

  const generate = async (overwriteConfirmed = false) => {
    if (!workspace) return
    if (activeSnapshots.length === 0 && !window.confirm(r.noActiveConfirm)) return
    if (staleCount && !window.confirm(r.staleConfirm(staleCount))) return
    setBusy(true)
    setMessage(r.generating)
    try {
      await saveReportBrand(workspace, brand, logoDataUrl, false)
      const savedSettings = await saveAllSettings()
      const result = await generateHtmlReport(
        workspace, savedSettings, outputPath, overwriteConfirmed, channelTouchstone || '')
      setLastOutput(result.output_path)
      const mismatch = result.locale_mismatch_count || 0
      setMessage(r.generated(result.output_path, result.snapshot_count)
        + (mismatch ? `\n${r.localeMismatch(mismatch)}` : ''))
      await refresh()
    } catch (error) {
      const typed = error as Error & { status?: number }
      if (typed.status === 409 && !overwriteConfirmed && window.confirm(r.overwriteConfirm(why(error)))) {
        setBusy(false)
        await generate(true)
        return
      }
      setFailure(r.generateFailed(why(error)))
    } finally {
      setBusy(false)
    }
  }

  const setCriteria = (key: string, value: string) => setSettings(current => ({
    ...current,
    acceptance_criteria: { ...current.acceptance_criteria, [key]: value },
  }))

  const insertWatermarkVariable = (variable: string) => setSettings(current => ({
    ...current,
    watermark: { ...current.watermark, text: `${current.watermark.text}${variable}` },
  }))

  const saveWatermarkTemplate = () => {
    const name = window.prompt(r.templateNamePrompt, r.templateDefaultName)?.trim()
    if (!name) return
    const template: WatermarkTemplate = {
      name,
      settings: { ...settings.watermark, enabled: false, image_data_url: undefined },
      imageDataUrl: watermarkDataUrl || undefined,
    }
    const next = [...watermarkTemplates.filter(item => item.name !== name), template]
    try {
      window.localStorage.setItem(WATERMARK_TEMPLATE_KEY, JSON.stringify(next))
      setWatermarkTemplates(next)
      setSelectedWatermarkTemplate(name)
      setMessage(r.templateSaved(name))
    } catch {
      setFailure(r.templateSaveFailed)
    }
  }

  const applyWatermarkTemplate = () => {
    const template = watermarkTemplates.find(item => item.name === selectedWatermarkTemplate)
    if (!template) return
    setSettings(current => ({
      ...current,
      watermark: { ...template.settings, enabled: current.watermark.enabled },
    }))
    setWatermarkDataUrl(template.imageDataUrl || '')
    setMessage(r.templateApplied(template.name))
  }

  const textFields: [keyof ReportSettings, string][] = [
    ['purpose', r.purpose], ['summary', r.summary],
    ['conclusion', r.conclusion], ['recommendations', r.recommendations],
  ]
  const vars = r.watermarkVars
  const watermarkVariables = [vars.company, vars.customer, vars.project,
    vars.reportNumber, vars.date, vars.confidentiality]

  return (
    <div className="report-center">
      <div className="report-center__header">
        <div><h2>{r.title}</h2><div>{r.subtitle}</div></div>
        <div className="report-workspace-open">
          <input aria-label={r.workspaceAria}
            value={workspaceInput} onChange={event => setWorkspaceInput(event.target.value)}
            placeholder={r.workspacePlaceholder} />
          <button className="btn" disabled={busy} onClick={openWorkspace}>{r.switchWorkspace}</button>
        </div>
      </div>
      <div className="report-summary-strip">
        <span>{r.workspaceIs(workspace || r.notOpened)}</span>
        <span>{r.activeCount(activeSnapshots.length)}</span>
        <span className={staleCount ? 'warn' : ''}>{r.staleCount(staleCount)}</span>
        <span>{r.exportCount(manifest?.exports?.length || 0)}</span>
      </div>
      <div className="report-tabs">
        {REPORT_TABS.map(key => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{r.tabs[key]}</button>
        ))}
      </div>

      <div className="report-center__body">
        {tab === 'snapshots' && (
          <div>
            <div className="report-toolbar-row">
              <strong>{r.snapshotsHint}</strong>
              <label className="btn report-file-button">{r.addExternal}
                <input type="file" accept="image/png,image/jpeg,image/svg+xml"
                  onChange={event => { void uploadExternal(event.target.files?.[0]); event.currentTarget.value = '' }} />
              </label>
            </div>
            {groups.length === 0 && <div className="report-empty">{r.noSnapshots}</div>}
            {groups.map(([kind, versions]) => (
              <div className="report-snapshot-group" key={kind}>
                <h3>{versions[0]?.title || kind}<small>{kind}</small></h3>
                <div className="report-snapshot-grid">
                  {versions.map(snapshot => (
                    <article key={snapshot.id} className={`report-snapshot-card ${snapshot.active ? 'active' : ''}`}>
                      <div className="report-thumb-wrap">
                        <img src={snapshotImageUrl(workspace, snapshot.id)} alt={snapshot.title} />
                        <span>v{snapshot.version}</span>
                        {snapshot.stale && <b>{r.staleBadge}</b>}
                      </div>
                      <div className="report-snapshot-fields">
                        <select aria-label={r.statusAria(snapshot.title)} value={snapshot.engineering_status}
                          onChange={event => void patchSnapshot(snapshot, { engineering_status: event.target.value as SnapshotStatus })}>
                          {STATUS_ORDER.map(value => <option key={value} value={value}>{r.status[value]}</option>)}
                        </select>
                        <select aria-label={r.sectionAria(snapshot.title)} value={snapshot.section}
                          onChange={event => void patchSnapshot(snapshot, { section: event.target.value })}>
                          {REPORT_SECTION_ORDER.map(section => <option key={section} value={section}>{reportSectionLabel(t, section)}</option>)}
                        </select>
                        <textarea aria-label={r.captionAria(snapshot.title)} value={snapshot.caption} rows={3}
                          onChange={event => setManifest(current => current ? {
                            ...current,
                            snapshots: current.snapshots.map(item => item.id === snapshot.id ? { ...item, caption: event.target.value } : item),
                          } : current)}
                          onBlur={event => void patchSnapshot(snapshot, { caption: event.target.value })} />
                        <label><input type="checkbox" checked={snapshot.selected}
                          onChange={event => void patchSnapshot(snapshot, { selected: event.target.checked })} /> {r.includeInReport}</label>
                        {!snapshot.active && <button className="btn" onClick={() => void useVersion(snapshot)}>{r.useThisVersion}</button>}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'brand' && (
          <div className="report-form-grid">
            <label>{r.companyName}<input value={brand.company_name} onChange={event => setBrand({ ...brand, company_name: event.target.value })} /></label>
            <label>{r.department}<input value={brand.department} onChange={event => setBrand({ ...brand, department: event.target.value })} /></label>
            <label>{r.projectName}<input value={brand.project_name} onChange={event => setBrand({ ...brand, project_name: event.target.value })} /></label>
            <label>{r.customerName}<input value={brand.customer_name} onChange={event => setBrand({ ...brand, customer_name: event.target.value })} /></label>
            <label>{r.reportNumber}<input value={brand.report_number} onChange={event => setBrand({ ...brand, report_number: event.target.value })} /></label>
            <label>{r.logo}<input type="file" accept="image/png,image/jpeg,image/svg+xml"
              onChange={event => { const file = event.target.files?.[0]; if (file) void fileToDataUrl(file).then(setLogoDataUrl) }} /></label>
            <div className="report-brand-preview">
              {(logoDataUrl || (workspace && brand.logo_file)) && <img src={logoDataUrl || `/api/report/brand/logo?workspace=${encodeURIComponent(workspace)}`} alt={r.logoAlt} />}
              <div><b>{brand.company_name || r.companyName}</b><span>{brand.project_name || r.projectName}</span></div>
            </div>
            <button className="btn btn--primary" disabled={!workspace || busy} onClick={() => void saveBrand()}>{r.saveBrand}</button>
          </div>
        )}

        {tab === 'content' && (
          <div className="report-content-grid">
            <div className="report-section-card"><h3>{r.sectionsTitle}</h3>
              {REPORT_SECTION_ORDER.map(section => (
                <label key={section}><input type="checkbox" checked={settings.sections.includes(section)}
                  onChange={event => setSettings(current => ({ ...current, sections: event.target.checked
                    ? [...current.sections, section]
                    : current.sections.filter(item => item !== section) }))} /> {reportSectionLabel(t, section)}</label>
              ))}
            </div>
            <div className="report-section-card"><h3>{r.criteriaTitle}</h3>
              <label>{r.freqRange}<input value={String(settings.acceptance_criteria.frequency_range || '')} onChange={event => setCriteria('frequency_range', event.target.value)} placeholder={r.freqRangePlaceholder} /></label>
              <label>{r.insertionLoss}<input value={String(settings.acceptance_criteria.insertion_loss || '')} onChange={event => setCriteria('insertion_loss', event.target.value)} placeholder={r.insertionLossPlaceholder} /></label>
              <label>{r.returnLoss}<input value={String(settings.acceptance_criteria.return_loss || '')} onChange={event => setCriteria('return_loss', event.target.value)} placeholder={r.returnLossPlaceholder} /></label>
              <label>{r.eyeLimit}<input value={String(settings.acceptance_criteria.eye || '')} onChange={event => setCriteria('eye', event.target.value)} /></label>
              <div className="report-muted">{r.criteriaNote}</div>
            </div>
            {textFields.map(([key, label]) => (
              <label className="report-wide" key={key}>{label}<textarea rows={4} value={String(settings[key] || '')}
                onChange={event => setSettings({ ...settings, [key]: event.target.value })} /></label>
            ))}
          </div>
        )}

        {tab === 'watermark' && (
          <div className="report-watermark-grid">
            <div className="report-section-card">
              <label className="report-switch"><input type="checkbox" checked={settings.watermark.enabled}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, enabled: event.target.checked } })} /> {r.watermarkEnable}</label>
              <label>{r.watermarkMode}<select value={settings.watermark.mode} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, mode: event.target.value as typeof settings.watermark.mode } })}>
                <option value="text">{r.modeText}</option><option value="image">{r.modeImage}</option><option value="both">{r.modeBoth}</option>
              </select></label>
              <label>{r.watermarkScope}<select value={settings.watermark.scope} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, scope: event.target.value as typeof settings.watermark.scope } })}>
                <option value="all">{r.scopeAll}</option><option value="images">{r.scopeImages}</option><option value="custom">{r.scopeCustom}</option>
              </select></label>
              <label>{r.watermarkLayout}<select value={settings.watermark.layout} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, layout: event.target.value as 'tile' | 'center' } })}>
                <option value="tile">{r.layoutTile}</option><option value="center">{r.layoutCenter}</option>
              </select></label>
              <label>{r.watermarkSize}<select value={settings.watermark.size} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, size: event.target.value as WatermarkSettings['size'] } })}>
                <option value="small">{r.sizeSmall}</option><option value="medium">{r.sizeMedium}</option><option value="large">{r.sizeLarge}</option>
              </select></label>
              <label>{r.watermarkImage}<input type="file" accept="image/png,image/jpeg,image/svg+xml"
                onChange={event => { const file = event.target.files?.[0]; if (file) void fileToDataUrl(file).then(setWatermarkDataUrl) }} /></label>
              {settings.watermark.scope === 'custom' && (
                <div className="report-custom-sections"><b>{r.customSections}</b>
                  {REPORT_SECTION_ORDER.map(section => <label key={section}><input type="checkbox"
                    checked={settings.watermark.sections.includes(section)}
                    onChange={event => setSettings(current => ({ ...current, watermark: {
                      ...current.watermark,
                      sections: event.target.checked
                        ? [...current.watermark.sections, section]
                        : current.watermark.sections.filter(item => item !== section),
                    } }))} /> {reportSectionLabel(t, section)}</label>)}
                </div>
              )}
            </div>
            <div className="report-section-card">
              <label>{r.watermarkText}<textarea rows={3} value={settings.watermark.text}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, text: event.target.value } })} /></label>
              {settings.watermark.text === DEFAULT_WATERMARK.text && (
                <div className="report-muted">{r.defaultWatermarkHint}</div>
              )}
              <div className="report-variable-buttons">
                {watermarkVariables.map(variable => (
                  <button className="btn" key={variable} onClick={() => insertWatermarkVariable(variable)}>+{variable}</button>
                ))}
              </div>
              <label>{r.opacity(Math.round(settings.watermark.opacity * 100))}<input type="range" min="0.03" max="0.45" step="0.01" value={settings.watermark.opacity}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, opacity: Number(event.target.value) } })} /></label>
              <label>{r.angle(settings.watermark.angle)}<input type="range" min="-90" max="90" step="1" value={settings.watermark.angle}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, angle: Number(event.target.value) } })} /></label>
              <label>{r.color}<input type="color" value={settings.watermark.color}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, color: event.target.value } })} /></label>
              <button className="btn" onClick={() => setSettings({ ...settings, watermark: { ...DEFAULT_WATERMARK } })}>{r.suggested}</button>
              <div className="report-template-row">
                <select aria-label={r.templateAria} value={selectedWatermarkTemplate} onChange={event => setSelectedWatermarkTemplate(event.target.value)}>
                  <option value="">{r.templatePick}</option>
                  {watermarkTemplates.map(template => <option key={template.name} value={template.name}>{template.name}</option>)}
                </select>
                <button className="btn" disabled={!selectedWatermarkTemplate} onClick={applyWatermarkTemplate}>{r.applyTemplate}</button>
                <button className="btn" onClick={saveWatermarkTemplate}>{r.saveTemplate}</button>
              </div>
            </div>
            <div className="report-watermark-preview">
              <div className="report-preview-watermark" style={{ opacity: settings.watermark.enabled ? settings.watermark.opacity : 0, transform: `rotate(${settings.watermark.angle}deg)`, color: settings.watermark.color }}>
                {(settings.watermark.mode === 'image' || settings.watermark.mode === 'both') && watermarkDataUrl && <img src={watermarkDataUrl} alt={r.watermarkAlt} />}
                {(settings.watermark.mode === 'text' || settings.watermark.mode === 'both') && <span>{settings.watermark.text || r.watermarkPreviewFallback}</span>}
              </div>
              <strong>{r.previewTitle}</strong><p>{r.previewNote}</p>
            </div>
          </div>
        )}

        {tab === 'export' && (
          <div className="report-export-grid">
            <div className="report-section-card">
              <label>{r.language}<select value={settings.locale} onChange={event => {
                // 選過就記住（卡 0087）：之後開報告中心、混合求解報告都用這個語言。
                const locale = event.target.value as ReportSettings['locale']
                rememberReportLocale(locale)
                setSettings({ ...settings, locale })
              }}>
                <option value="zh-TW">{r.localeZh}</option><option value="en">{r.localeEn}</option><option value="bilingual">{r.localeBilingual}</option>
              </select></label>
              <div className="report-muted">{r.localeHint}</div>
              <label>{r.securityMode}<select value={settings.security_mode} onChange={event => setSettings({ ...settings, security_mode: event.target.value as ReportSettings['security_mode'] })}>
                <option value="external">{r.securityExternal}</option><option value="internal">{r.securityInternal}</option>
              </select></label>
              <label>{r.quality}<select value={settings.quality} onChange={event => setSettings({ ...settings, quality: event.target.value as ReportSettings['quality'] })}>
                <option value="compact">{r.qualityCompact}</option><option value="standard">{r.qualityStandard}</option><option value="high">{r.qualityHigh}</option>
              </select></label>
              <label>{r.outputPath}<input value={outputPath} onChange={event => setOutputPath(event.target.value)} placeholder={r.outputPathPlaceholder} /></label>
            </div>
            <div className="report-preflight">
              <h3>{r.preflight}</h3>
              <div className={activeSnapshots.length ? 'ok' : 'warn'}>{r.activeCount(activeSnapshots.length)}</div>
              <div className={staleCount ? 'warn' : 'ok'}>{r.staleCount(staleCount)}</div>
              {mismatchCount > 0 && <div className="warn">{r.localeMismatch(mismatchCount)}</div>}
              <div className={brand.company_name ? 'ok' : 'warn'}>{r.companyIs(brand.company_name || r.notSet)}</div>
              <div className={settings.watermark.enabled ? 'ok' : ''}>{settings.watermark.enabled ? r.watermarkOn : r.watermarkOff}</div>
              <div>{r.sectionCount(settings.sections.length)}</div>
              <button className="btn btn--primary report-generate" disabled={!workspace || busy} onClick={() => void generate()}>
                {busy ? r.generatingButton : r.generateButton}
              </button>
              {(lastOutput || (manifest?.exports?.length || 0) > 0) && (
                <button className="btn" onClick={() => void openLatest()}>{r.openLatest}</button>
              )}
              {lastOutput && <div className="report-output-path">{lastOutput}</div>}
            </div>
          </div>
        )}
      </div>
      {message.text && <div className={message.error ? 'report-center__message error' : 'report-center__message'}>{message.text}</div>}
    </div>
  )
}
