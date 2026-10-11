// 單一眼圖入口的多埠分支：完整沿用多道／DDR strobe／串擾流程。
import MultiLaneWizard from './MultiLaneWizard'
import type { MultiLaneWizardProps } from './MultiLaneWizard'

export interface MultiPortEyeWizardProps extends MultiLaneWizardProps {
  touchstonePath: string
  dataRateGbps: number | null
  onTouchstoneChange: (path: string) => void
  onDataRateChange: (rate: number) => void
}

export default function MultiPortEyeWizard(props: MultiPortEyeWizardProps) {
  return <MultiLaneWizard {...props} />
}
