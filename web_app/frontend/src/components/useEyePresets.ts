// 讀常見規範預設：眼圖精靈第 2 步與多埠精靈的世代下拉共用一份。
// 整個頁面只抓一次；抓不到（舊後端沒有這個端點）就回 error，畫面寫原因，
// 精靈照常可以手填。
import { useEffect, useState } from 'react'
import type { PresetResponse } from '../eyePresets'

let cached: Promise<PresetResponse> | null = null

async function load(): Promise<PresetResponse> {
  const response = await fetch('/api/eye-presets')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  if (!data || !Array.isArray(data.presets)) throw new Error('presets missing')
  return data as PresetResponse
}

export function useEyePresets(): { data: PresetResponse | null; error: boolean } {
  const [state, setState] = useState<{ data: PresetResponse | null; error: boolean }>(
    { data: null, error: false })
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        if (!cached) cached = load()
        const data = await cached
        if (alive) setState({ data, error: false })
      } catch {
        cached = null // 下次掛載再試，不把一次失敗記一輩子
        if (alive) setState({ data: null, error: true })
      }
    })()
    return () => { alive = false }
  }, [])
  return state
}
