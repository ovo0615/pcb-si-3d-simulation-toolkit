import type { Funnel } from './eyeWizard'

export interface SelectorInput {
  packageId: string
  selector: string
  side: number
  dataRateGbps: number
  driving: boolean | null
  odtOhm: number | null
  driveOhm: number | null
  technology?: string
  directModel?: string
}

export interface SelectorChange {
  inputSignature: string
  model: string
  odtOhm: number | null
  driveOhm: number | null
  requiresUser: boolean
  selectionBasis: Record<string, unknown>
}

export function selectorSignature(input: SelectorInput): string {
  return JSON.stringify([input.packageId, input.selector, input.side, input.dataRateGbps,
    input.driving, input.odtOhm, input.driveOhm, input.technology || '', input.directModel || ''])
}

/** 舊回應不能替新答案選型；覆寫模型必須附理由。 */
export function selectorSelection(input: SelectorInput,
  check: { signature: string; data: Funnel } | null,
  override: { enabled: boolean; model: string; reason: string; pick: string },
  directModel?: string): SelectorChange {
  const current = check?.signature === selectorSignature(input) ? check.data : null
  const ready = (current || directModel !== undefined) && input.driving !== null && input.dataRateGbps > 0
  let model = ''
  if (ready) {
    if (directModel !== undefined) {
      model = directModel
    } else if (override.enabled) {
      if (override.reason.trim()) model = override.model
    } else {
      model = current!.selected || (current!.remaining.some(v => v.name === override.pick) ? override.pick : '')
    }
  }
  return {
    inputSignature: selectorSignature(input),
    model, odtOhm: input.odtOhm, driveOhm: input.driveOhm, requiresUser: !model,
    selectionBasis: {
      side: input.side, package_id: input.packageId, selector: input.selector,
      model, basis: directModel !== undefined ? 'plain' : override.enabled ? 'override' : 'funnel',
      data_rate_gbps: input.dataRateGbps, driving: input.driving,
      odt_ohm: input.odtOhm, drive_ohm: input.driveOhm,
      ...(input.technology ? { technology: input.technology } : {}),
      ...(override.enabled && directModel === undefined ? { override_reason: override.reason.trim() } : {}),
    },
  }
}
