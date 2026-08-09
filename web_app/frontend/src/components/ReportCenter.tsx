// 一鍵 HTML 報告中心：快照、品牌、章節、規格、浮水印與輸出。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
import { useEffect, useMemo, useState } from 'react'

import {
  activateReportSnapshot,
  createReportSnapshot,
  fileToDataUrl,
  generateHtmlReport,
  loadReportWorkspace,
  openReportWorkspace,
  saveReportBrand,
  saveReportSettings,
  snapshotImageUrl,
  updateReportSnapshot,
} from '../reportApi'
import {
  DEFAULT_REPORT_SETTINGS,
  DEFAULT_WATERMARK,
  REPORT_SECTION_LABELS,
  REPORT_SECTION_ORDER,
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

const STATUS_LABEL: Record<SnapshotStatus, string> = {
  pass: '通過', attention: '注意', fail: '失敗', display: '僅供展示',
}

function normalizedSettings(value: Partial<ReportSettings> | undefined): ReportSettings {
  return {
    ...DEFAULT_REPORT_SETTINGS,
    ...(value || {}),
    sections: value?.sections?.length ? value.sections : REPORT_SECTION_ORDER,
    acceptance_criteria: value?.acceptance_criteria || {},
    watermark: { ...DEFAULT_WATERMARK, ...(value?.watermark || {}) },
  }
}

export default function ReportCenter({ basePath, projectName, onWorkspaceChange }: Props) {
  const [tab, setTab] = useState<ReportTab>('snapshots')
  const [workspaceInput, setWorkspaceInput] = useState(basePath)
  const [workspace, setWorkspace] = useState('')
  const [manifest, setManifest] = useState<ReportManifest | null>(null)
  const [brand, setBrand] = useState<ReportBrand>({ ...EMPTY_BRAND, project_name: projectName })
  const [settings, setSettings] = useState<ReportSettings>(DEFAULT_REPORT_SETTINGS)
  const [logoDataUrl, setLogoDataUrl] = useState('')
  const [watermarkDataUrl, setWatermarkDataUrl] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [lastOutput, setLastOutput] = useState('')
  const [watermarkTemplates, setWatermarkTemplates] = useState<WatermarkTemplate[]>(loadWatermarkTemplates)
  const [selectedWatermarkTemplate, setSelectedWatermarkTemplate] = useState('')

  const refresh = async (target = workspace) => {
    if (!target) return
    const result = await loadReportWorkspace(target)
    setWorkspace(result.workspace)
    setManifest(result.manifest)
    setBrand({ ...EMPTY_BRAND, ...result.brand_profile, ...result.manifest.brand })
    if (result.brand_profile.logo_data_url && !result.manifest.brand.logo_file) {
      setLogoDataUrl(result.brand_profile.logo_data_url)
    }
    setSettings(normalizedSettings(result.manifest.settings))
    onWorkspaceChange?.(result.workspace)
  }

  /** 手動切換到別的工作區。留空＝回到預設目錄。 */
  const openWorkspace = async () => {
    setBusy(true)
    try {
      const result = await openReportWorkspace(workspaceInput, projectName || 'PCB SI 分析專案')
      setWorkspace(result.workspace)
      setManifest(result.manifest)
      setBrand({ ...EMPTY_BRAND, ...result.brand_profile, ...result.manifest.brand })
      if (result.brand_profile.logo_data_url && !result.manifest.brand.logo_file) {
        setLogoDataUrl(result.brand_profile.logo_data_url)
      }
      setSettings(normalizedSettings(result.manifest.settings))
      setMessage(`報告工作區已開啟：${result.workspace}`)
      onWorkspaceChange?.(result.workspace)
    } catch (error) {
      setMessage(`開啟工作區失敗：${String((error as Error)?.message || error)}`)
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
      void openReportWorkspace(basePath, projectName || 'PCB SI 分析專案').then(result => {
        setWorkspace(result.workspace)
        setManifest(result.manifest)
        setBrand({ ...EMPTY_BRAND, ...result.brand_profile, ...result.manifest.brand })
        if (result.brand_profile.logo_data_url && !result.manifest.brand.logo_file) {
          setLogoDataUrl(result.brand_profile.logo_data_url)
        }
        setSettings(normalizedSettings(result.manifest.settings))
        setWorkspaceInput(result.workspace)
        onWorkspaceChange?.(result.workspace)
      }).catch(() => undefined)
    }
  }, [basePath, projectName, workspace, onWorkspaceChange])

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

  const patchSnapshot = async (
    snapshot: ReportSnapshot,
    changes: Partial<Pick<ReportSnapshot, 'caption' | 'engineering_status' | 'section' | 'selected'>>,
  ) => {
    if (!workspace) return
    try {
      await updateReportSnapshot(workspace, snapshot.id, changes)
      await refresh()
    } catch (error) {
      setMessage(`更新快照失敗：${String((error as Error)?.message || error)}`)
    }
  }

  const useVersion = async (snapshot: ReportSnapshot) => {
    if (!workspace) return
    await activateReportSnapshot(workspace, snapshot.id)
    await refresh()
  }

  const uploadExternal = async (file: File | undefined) => {
    if (!file || !workspace) return
    const caption = window.prompt('請輸入這張補充圖片的圖說：', file.name) ?? ''
    const dataUrl = await fileToDataUrl(file)
    await createReportSnapshot({
      workspace, kind: `external-${Date.now()}`, title: file.name,
      image_data_url: dataUrl, caption, engineering_status: 'display',
      section: 'external', external: true,
    })
    await refresh()
  }

  const saveBrand = async () => {
    if (!workspace) return
    setBusy(true)
    try {
      await saveReportBrand(workspace, brand, logoDataUrl, true)
      await refresh()
      setLogoDataUrl('')
      setMessage('品牌設定已保存；新專案仍需自行確認是否套用浮水印。')
    } catch (error) {
      setMessage(`保存品牌失敗：${String((error as Error)?.message || error)}`)
    } finally {
      setBusy(false)
    }
  }

  const saveAllSettings = async (): Promise<ReportSettings> => {
    if (!workspace) throw new Error('請先開啟報告工作區。')
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
    if (activeSnapshots.length === 0 && !window.confirm('目前沒有作用中的結果快照，仍要產生只有文字的報告嗎？')) return
    if (staleCount && !window.confirm(`有 ${staleCount} 張快照可能已過期，仍要產生報告嗎？`)) return
    setBusy(true)
    setMessage('正在產生自包含 HTML 報告…')
    try {
      await saveReportBrand(workspace, brand, logoDataUrl, false)
      const savedSettings = await saveAllSettings()
      const result = await generateHtmlReport(workspace, savedSettings, outputPath, overwriteConfirmed)
      setLastOutput(result.output_path)
      setMessage(`報告完成：${result.output_path}（${result.snapshot_count} 張快照）`)
      await refresh()
    } catch (error) {
      const typed = error as Error & { status?: number }
      if (typed.status === 409 && !overwriteConfirmed && window.confirm(`${typed.message}\n\n確定要覆寫嗎？`)) {
        setBusy(false)
        await generate(true)
        return
      }
      setMessage(`產生報告失敗：${typed.message || String(error)}`)
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
    const name = window.prompt('請輸入浮水印範本名稱：', '公司機密')?.trim()
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
      setMessage(`已保存浮水印範本「${name}」；新專案套用後仍需自行勾選啟用。`)
    } catch {
      setMessage('保存浮水印範本失敗：圖片可能過大，請改用較小的 PNG。')
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
    setMessage(`已帶入「${template.name}」；為避免誤用客戶資料，浮水印啟用狀態不會自動開啟。`)
  }

  return (
    <div className="report-center">
      <div className="report-center__header">
        <div><h2>一鍵 HTML 報告中心</h2><div>各結果畫面的最新作用中快照會自動帶入報告。</div></div>
        <div className="report-workspace-open">
          <input value={workspaceInput} onChange={event => setWorkspaceInput(event.target.value)}
            placeholder="留空＝預設目錄；或指定分析輸出目錄／既有 report_workspace" />
          <button className="btn" disabled={busy} onClick={openWorkspace}>切換工作區</button>
        </div>
      </div>
      <div className="report-summary-strip">
        <span>工作區：{workspace || '尚未開啟'}</span>
        <span>作用中快照：{activeSnapshots.length}</span>
        <span className={staleCount ? 'warn' : ''}>可能過期：{staleCount}</span>
        <span>歷次報告：{manifest?.exports?.length || 0}</span>
      </div>
      <div className="report-tabs">
        {([
          ['snapshots', '快照總覽'], ['brand', '品牌'], ['content', '內容與規格'],
          ['watermark', '浮水印'], ['export', '預覽與輸出'],
        ] as [ReportTab, string][]).map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      <div className="report-center__body">
        {tab === 'snapshots' && (
          <div>
            <div className="report-toolbar-row">
              <strong>每個畫面最多保留五版；藍框是目前報告使用版本。</strong>
              <label className="btn report-file-button">＋ 加入補充圖片
                <input type="file" accept="image/png,image/jpeg,image/svg+xml"
                  onChange={event => { void uploadExternal(event.target.files?.[0]); event.currentTarget.value = '' }} />
              </label>
            </div>
            {groups.length === 0 && <div className="report-empty">尚無快照。請到結果畫面按「更新報告快照」。</div>}
            {groups.map(([kind, versions]) => (
              <div className="report-snapshot-group" key={kind}>
                <h3>{versions[0]?.title || kind}<small>{kind}</small></h3>
                <div className="report-snapshot-grid">
                  {versions.map(snapshot => (
                    <article key={snapshot.id} className={`report-snapshot-card ${snapshot.active ? 'active' : ''}`}>
                      <div className="report-thumb-wrap">
                        <img src={snapshotImageUrl(workspace, snapshot.id)} alt={snapshot.title} />
                        <span>v{snapshot.version}</span>
                        {snapshot.stale && <b>可能已過期</b>}
                      </div>
                      <div className="report-snapshot-fields">
                        <select value={snapshot.engineering_status}
                          onChange={event => void patchSnapshot(snapshot, { engineering_status: event.target.value as SnapshotStatus })}>
                          {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                        <select value={snapshot.section}
                          onChange={event => void patchSnapshot(snapshot, { section: event.target.value })}>
                          {REPORT_SECTION_ORDER.map(section => <option key={section} value={section}>{REPORT_SECTION_LABELS[section]}</option>)}
                        </select>
                        <textarea value={snapshot.caption} rows={3}
                          onChange={event => setManifest(current => current ? {
                            ...current,
                            snapshots: current.snapshots.map(item => item.id === snapshot.id ? { ...item, caption: event.target.value } : item),
                          } : current)}
                          onBlur={event => void patchSnapshot(snapshot, { caption: event.target.value })} />
                        <label><input type="checkbox" checked={snapshot.selected}
                          onChange={event => void patchSnapshot(snapshot, { selected: event.target.checked })} /> 加入報告</label>
                        {!snapshot.active && <button className="btn" onClick={() => void useVersion(snapshot)}>設為目前版本</button>}
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
            <label>公司名稱<input value={brand.company_name} onChange={event => setBrand({ ...brand, company_name: event.target.value })} /></label>
            <label>部門<input value={brand.department} onChange={event => setBrand({ ...brand, department: event.target.value })} /></label>
            <label>專案名稱<input value={brand.project_name} onChange={event => setBrand({ ...brand, project_name: event.target.value })} /></label>
            <label>客戶名稱<input value={brand.customer_name} onChange={event => setBrand({ ...brand, customer_name: event.target.value })} /></label>
            <label>報告編號<input value={brand.report_number} onChange={event => setBrand({ ...brand, report_number: event.target.value })} /></label>
            <label>公司 Logo（PNG／JPG／SVG）<input type="file" accept="image/png,image/jpeg,image/svg+xml"
              onChange={event => { const file = event.target.files?.[0]; if (file) void fileToDataUrl(file).then(setLogoDataUrl) }} /></label>
            <div className="report-brand-preview">
              {(logoDataUrl || (workspace && brand.logo_file)) && <img src={logoDataUrl || `/api/report/brand/logo?workspace=${encodeURIComponent(workspace)}`} alt="公司 Logo" />}
              <div><b>{brand.company_name || '公司名稱'}</b><span>{brand.project_name || '專案名稱'}</span></div>
            </div>
            <button className="btn btn--primary" disabled={!workspace || busy} onClick={() => void saveBrand()}>保存品牌設定</button>
          </div>
        )}

        {tab === 'content' && (
          <div className="report-content-grid">
            <div className="report-section-card"><h3>報告章節</h3>
              {REPORT_SECTION_ORDER.map(section => (
                <label key={section}><input type="checkbox" checked={settings.sections.includes(section)}
                  onChange={event => setSettings(current => ({ ...current, sections: event.target.checked
                    ? [...current.sections, section]
                    : current.sections.filter(item => item !== section) }))} /> {REPORT_SECTION_LABELS[section]}</label>
              ))}
            </div>
            <div className="report-section-card"><h3>驗收規格</h3>
              <label>頻率範圍<input value={String(settings.acceptance_criteria.frequency_range || '')} onChange={event => setCriteria('frequency_range', event.target.value)} placeholder="例如 0.1～50 GHz" /></label>
              <label>插入損耗門檻<input value={String(settings.acceptance_criteria.insertion_loss || '')} onChange={event => setCriteria('insertion_loss', event.target.value)} placeholder="例如 ≥ −12 dB @ 28 GHz" /></label>
              <label>回波損耗門檻<input value={String(settings.acceptance_criteria.return_loss || '')} onChange={event => setCriteria('return_loss', event.target.value)} placeholder="例如 ≤ −10 dB" /></label>
              <label>眼高／眼寬門檻<input value={String(settings.acceptance_criteria.eye || '')} onChange={event => setCriteria('eye', event.target.value)} /></label>
              <div className="report-muted">未填門檻時只呈現數值，不自動宣稱合格。</div>
            </div>
            {([
              ['purpose', '分析目的'], ['summary', '結果摘要'], ['conclusion', '工程結論'], ['recommendations', '改善建議'],
            ] as [keyof ReportSettings, string][]).map(([key, label]) => (
              <label className="report-wide" key={key}>{label}<textarea rows={4} value={String(settings[key] || '')}
                onChange={event => setSettings({ ...settings, [key]: event.target.value })} /></label>
            ))}
          </div>
        )}

        {tab === 'watermark' && (
          <div className="report-watermark-grid">
            <div className="report-section-card">
              <label className="report-switch"><input type="checkbox" checked={settings.watermark.enabled}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, enabled: event.target.checked } })} /> 啟用浮水印</label>
              <label>模式<select value={settings.watermark.mode} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, mode: event.target.value as typeof settings.watermark.mode } })}>
                <option value="text">文字</option><option value="image">圖片</option><option value="both">圖片＋文字</option>
              </select></label>
              <label>範圍<select value={settings.watermark.scope} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, scope: event.target.value as typeof settings.watermark.scope } })}>
                <option value="all">整份報告</option><option value="images">僅結果圖片</option><option value="custom">自訂章節</option>
              </select></label>
              <label>排列<select value={settings.watermark.layout} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, layout: event.target.value as 'tile' | 'center' } })}>
                <option value="tile">重複平鋪</option><option value="center">單一置中</option>
              </select></label>
              <label>大小<select value={settings.watermark.size} onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, size: event.target.value as WatermarkSettings['size'] } })}>
                <option value="small">小</option><option value="medium">中</option><option value="large">大</option>
              </select></label>
              <label>圖片<input type="file" accept="image/png,image/jpeg,image/svg+xml"
                onChange={event => { const file = event.target.files?.[0]; if (file) void fileToDataUrl(file).then(setWatermarkDataUrl) }} /></label>
              {settings.watermark.scope === 'custom' && (
                <div className="report-custom-sections"><b>套用章節</b>
                  {REPORT_SECTION_ORDER.map(section => <label key={section}><input type="checkbox"
                    checked={settings.watermark.sections.includes(section)}
                    onChange={event => setSettings(current => ({ ...current, watermark: {
                      ...current.watermark,
                      sections: event.target.checked
                        ? [...current.watermark.sections, section]
                        : current.watermark.sections.filter(item => item !== section),
                    } }))} /> {REPORT_SECTION_LABELS[section]}</label>)}
                </div>
              )}
            </div>
            <div className="report-section-card">
              <label>文字<textarea rows={3} value={settings.watermark.text}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, text: event.target.value } })} /></label>
              <div className="report-variable-buttons">
                {['{公司名稱}', '{客戶名稱}', '{專案名稱}', '{報告編號}', '{產生日期}', '{機密等級}'].map(variable => (
                  <button className="btn" key={variable} onClick={() => insertWatermarkVariable(variable)}>＋{variable}</button>
                ))}
              </div>
              <label>透明度：{Math.round(settings.watermark.opacity * 100)}%<input type="range" min="0.03" max="0.45" step="0.01" value={settings.watermark.opacity}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, opacity: Number(event.target.value) } })} /></label>
              <label>角度：{settings.watermark.angle}°<input type="range" min="-90" max="90" step="1" value={settings.watermark.angle}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, angle: Number(event.target.value) } })} /></label>
              <label>顏色<input type="color" value={settings.watermark.color}
                onChange={event => setSettings({ ...settings, watermark: { ...settings.watermark, color: event.target.value } })} /></label>
              <button className="btn" onClick={() => setSettings({ ...settings, watermark: { ...DEFAULT_WATERMARK } })}>帶入建議設定</button>
              <div className="report-template-row">
                <select value={selectedWatermarkTemplate} onChange={event => setSelectedWatermarkTemplate(event.target.value)}>
                  <option value="">選擇浮水印範本…</option>
                  {watermarkTemplates.map(template => <option key={template.name} value={template.name}>{template.name}</option>)}
                </select>
                <button className="btn" disabled={!selectedWatermarkTemplate} onClick={applyWatermarkTemplate}>套用範本</button>
                <button className="btn" onClick={saveWatermarkTemplate}>另存範本</button>
              </div>
            </div>
            <div className="report-watermark-preview">
              <div className="report-preview-watermark" style={{ opacity: settings.watermark.enabled ? settings.watermark.opacity : 0, transform: `rotate(${settings.watermark.angle}deg)`, color: settings.watermark.color }}>
                {(settings.watermark.mode === 'image' || settings.watermark.mode === 'both') && watermarkDataUrl && <img src={watermarkDataUrl} alt="浮水印" />}
                {(settings.watermark.mode === 'text' || settings.watermark.mode === 'both') && <span>{settings.watermark.text || '機密文件'}</span>}
              </div>
              <strong>S 參數／Layout 報告預覽區</strong><p>浮水印只作為識別與提醒，不是防止 HTML 被修改的 DRM。</p>
            </div>
          </div>
        )}

        {tab === 'export' && (
          <div className="report-export-grid">
            <div className="report-section-card">
              <label>語言<select value={settings.locale} onChange={event => setSettings({ ...settings, locale: event.target.value as ReportSettings['locale'] })}>
                <option value="zh-TW">繁體中文</option><option value="en">English</option><option value="bilingual">中英雙語</option>
              </select></label>
              <label>安全模式<select value={settings.security_mode} onChange={event => setSettings({ ...settings, security_mode: event.target.value as ReportSettings['security_mode'] })}>
                <option value="external">對外安全模式（隱藏本機路徑）</option><option value="internal">內部工程模式</option>
              </select></label>
              <label>輸出品質<select value={settings.quality} onChange={event => setSettings({ ...settings, quality: event.target.value as ReportSettings['quality'] })}>
                <option value="compact">精簡</option><option value="standard">標準</option><option value="high">高品質</option>
              </select></label>
              <label>自訂輸出 HTML（可留白）<input value={outputPath} onChange={event => setOutputPath(event.target.value)} placeholder="留白時自動加上日期時間" /></label>
            </div>
            <div className="report-preflight">
              <h3>輸出前檢查</h3>
              <div className={activeSnapshots.length ? 'ok' : 'warn'}>作用中快照：{activeSnapshots.length}</div>
              <div className={staleCount ? 'warn' : 'ok'}>可能過期：{staleCount}</div>
              <div className={brand.company_name ? 'ok' : 'warn'}>公司名稱：{brand.company_name || '尚未設定'}</div>
              <div className={settings.watermark.enabled ? 'ok' : ''}>浮水印：{settings.watermark.enabled ? '啟用' : '關閉'}</div>
              <div>章節：{settings.sections.length}</div>
              <button className="btn btn--primary report-generate" disabled={!workspace || busy} onClick={() => void generate()}>
                {busy ? '產生中…' : '一鍵產生 HTML 報告'}
              </button>
              {(lastOutput || (manifest?.exports?.length || 0) > 0) && (
                <button className="btn" onClick={() => window.open(`/api/report/export/latest?workspace=${encodeURIComponent(workspace)}`, '_blank')}>開啟最近報告</button>
              )}
              {lastOutput && <div className="report-output-path">{lastOutput}</div>}
            </div>
          </div>
        )}
      </div>
      {message && <div className={message.includes('失敗') ? 'report-center__message error' : 'report-center__message'}>{message}</div>}
      <footer>此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供</footer>
    </div>
  )
}
