// 結果頁的「開啟模擬資料夾」（#0115）：每一種分析完成後都有一顆。
//
// 走 `/api/open_result_folder`：後端只開它自己產出的資料夾，這裡傳的是結果
// JSON 裡的輸出路徑（資料夾或檔案；檔案就開所在資料夾並選取它）。
// `dark` 給右側深色檢視區（QuickEye、TDR、S 參數、截面阻抗）用。
import { useEffect, useState } from 'react'
import { revealResultFolder } from '../revealPath'
import { useT } from '../i18n'

export default function OpenFolderButton({ path, dark }: { path?: string | null; dark?: boolean }) {
  const { t, lang } = useT()
  const [error, setError] = useState('')
  const target = (path || '').trim()
  useEffect(() => { setError('') }, [target])
  if (!target) return null
  return (
    <span className={'open-folder' + (dark ? ' open-folder--dark' : '')}>
      <button type="button" className="btn" title={t.openSimFolder.title(target)}
        onClick={async () => setError(await revealResultFolder(target, lang) || '')}>
        {t.openSimFolder.label}</button>
      {error && <span className="open-folder__error" role="alert">{error}</span>}
    </span>
  )
}
