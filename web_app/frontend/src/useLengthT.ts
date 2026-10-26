import { useT } from './i18n'
import { useLengthUnit } from './lengthContext'
import { lengthText } from './lengthText'
import { useMemo } from 'react'
import type { DisplayLengthUnit } from './lengthUnits'

export function useLengthT(explicit?: DisplayLengthUnit) {
  const result = useT()
  const { unit } = useLengthUnit(explicit)
  const t = useMemo(() => lengthText(result.t, unit, result.lang), [result.t, unit, result.lang])
  return { ...result, t }
}
