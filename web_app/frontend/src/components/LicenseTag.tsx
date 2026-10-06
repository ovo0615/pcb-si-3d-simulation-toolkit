// 會用到 Ansys 的按鈕旁邊那一行：需要哪些授權、目前可用幾個。
// 沒有空位時整行變紅並直接寫原因；按鈕本身由呼叫端用 licenseBlock() 變灰。
import {
  LICENSE_COLORS, licenseBlock, licenseSummary, useAnsysLicense, type AnsysFunction,
} from '../ansysLicense'

export function LicenseTag({ functions, style }: {
  functions: AnsysFunction[]
  style?: React.CSSProperties
}) {
  const { status, error } = useAnsysLicense()
  if (!status && error) {
    return (
      <div style={{ fontSize: 10.5, color: LICENSE_COLORS.unknown, marginTop: 3, ...style }}>
        {error}；仍可嘗試，Ansys 拿不到授權時會明確告知。
      </div>
    )
  }
  const summary = licenseSummary(status, functions)
  const blocked = licenseBlock(status, functions)
  const unknownMessage = status && summary.state === 'unknown'
    ? functions.map(key => status.functions[key]?.message).find(Boolean) : ''
  return (
    <div style={{ fontSize: 10.5, color: LICENSE_COLORS[summary.state], marginTop: 3,
                  lineHeight: 1.4, ...style }}
      title="Ansys 授權對照與目前可用數量：說明 → Ansys 授權對照">
      {blocked || summary.text}
      {unknownMessage ? `（${unknownMessage}仍可嘗試。）` : ''}
    </div>
  )
}

export function useLicenseBlock(functions: AnsysFunction[]): string | null {
  const { status } = useAnsysLicense()
  return licenseBlock(status, functions)
}
