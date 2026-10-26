// 後端行程是唯一開關來源；不寫 localStorage、profile 或工作階段快照。
let enabled = false
const listeners = new Set<() => void>()
export const betaEnabled = () => enabled
export function subscribeBeta(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function updateBeta(value: boolean): void {
  if (value === enabled) return
  enabled = value
  listeners.forEach(listener => listener())
}
export async function syncBeta(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl('/api/feature-tiers', { cache: 'no-store' })
    if (!response.ok) throw new Error('Beta state unavailable')
    updateBeta((await response.json()).beta_enabled === true)
  } catch {
    updateBeta(false)
  }
  return enabled
}
