/** 設定檔保存的 HTTP／確認框邊界。 */
import type { Messages } from './i18n/zh-TW'
import { zhTW } from './i18n/zh-TW'

export type ProfileSettings = { specName: string; maxFrequencyGHz: number | string }
type Api = (url: string, body?: unknown) => Promise<any>

export async function confirmProfileOverwrite(
  api: Api, confirm: (message: string) => boolean | Promise<boolean>, name: string,
  settings: ProfileSettings, text: Messages['simulationSetup'] = zhTW.simulationSetup,
  specs: { name: string; label?: string; label_en?: string }[] = [], lang = 'zh-TW',
): Promise<boolean> {
  name = name.trim()
  // 新增被後端判為同名後，才讀最新兩欄及版本供使用者確認。
  const current = await api('/api/settings-profiles/get', { name })
  const label = (value: string) => {
    if (!value) return text.custom
    const spec = specs.find(item => item.name === value)
    return (lang === 'en' ? spec?.label_en : spec?.label) || value
  }
  const message = [text.overwriteProfile(name),
    text.profileDifference(text.spec, label(current.settings.specName), label(settings.specName)),
    text.profileDifference(text.maximum, String(current.settings.maxFrequencyGHz), String(settings.maxFrequencyGHz)),
  ].join('\n')
  if (!await confirm(message)) return false
  await api('/api/settings-profiles/save', { name, settings,
    overwrite: true, expected_revision: current.revision })
  return true
}
