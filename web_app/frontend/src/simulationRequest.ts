/** 寫入或驗收求解條件時，必須使用畫面這一版的兩欄輸入。停止／查結果不受限。 */
const SETTINGS_ENDPOINTS = new Set([
  '/api/ports_setup', '/api/schedule/start', '/api/remote/pack',
  '/api/segment/run', '/api/segment/run-single', '/api/segment/analyze',
  '/api/segment/analyze-complexity', '/api/schedule/bandwidth',
])

export function simulationPayload(
  url: string, body: any, choices: { specName: string; maxFrequencyGHz: string },
  ready: boolean, pendingMessage: string,
): any {
  if (body === undefined || !SETTINGS_ENDPOINTS.has(url)) return body
  const maximum = Number(choices.maxFrequencyGHz)
  if (!ready || !Number.isFinite(maximum) || maximum <= 0.1) throw new Error(pendingMessage)
  return { ...body, spec_name: choices.specName, max_frequency_ghz: maximum }
}
