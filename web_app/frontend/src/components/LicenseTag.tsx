// 會用到 Ansys 的按鈕旁邊那一行：需要哪些授權、目前可用幾個。
// 沒有空位時整行變紅並直接寫原因；按鈕本身由呼叫端用 licenseBlock() 變灰。
import {
  LICENSE_COLORS, licenseBlock, licenseSummary, licenseText, useAnsysLicense, type AnsysFunction,
} from '../ansysLicense'
import { useT } from '../i18n'

export function LicenseTag({ functions, style }: {
  functions: AnsysFunction[]
  style?: React.CSSProperties
}) {
  const { t, lang } = useT()
  const { status, error } = useAnsysLicense()
  if (!status && error) {
    return (
      <div style={{ fontSize: 12, color: LICENSE_COLORS.unknown, marginTop: 3, ...style }}>
        {t.license.statusUnreadable(error)}{t.license.stillTry}
      </div>
    )
  }
  const summary = licenseSummary(status, functions, t.license)
  const blocked = licenseBlock(status, functions, lang)
  const unknownMessage = status && summary.state === 'unknown'
    ? functions.map(key => licenseText(status.functions[key], 'message', lang)).find(Boolean) : ''
  return (
    <div style={{ fontSize: 12, color: LICENSE_COLORS[summary.state], marginTop: 3,
                  lineHeight: 1.4, ...style }}
      title={t.license.tagTitle}>
      {blocked || summary.text}
      {unknownMessage ? t.license.unknownNote(unknownMessage) : ''}
    </div>
  )
}

export function useLicenseBlock(functions: AnsysFunction[]): string | null {
  const { lang } = useT()
  const { status } = useAnsysLicense()
  return licenseBlock(status, functions, lang)
}
