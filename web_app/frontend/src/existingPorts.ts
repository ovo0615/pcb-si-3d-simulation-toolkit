/** 板上既有的元件端 Port（#0122，後端 `existing_component_ports`）。 */
export interface ExistingPort {
  name: string
  net: string
  component: string
}

/** 把載入結果的 `existing_ports` 收成型別正確的清單；舊後端沒有這個欄位就是空的。 */
export function readExistingPorts(raw: unknown): ExistingPort[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(item => ({
      name: String(item.name ?? ''),
      net: String(item.net ?? ''),
      component: String(item.component ?? ''),
    }))
}

/** 從既有 Port 推回訊號網路：依 Port 出現順序去重，只留板上真的有、
 *  而且不是參考網路的那些。
 *
 *  載入「已裁切、已設 Port」的板時，訊號網路原本要手動再選一次，沒選就被
 *  「請先選擇訊號網路」擋下（研究報告情境 C）；Port 已經講清楚是哪幾條了。 */
export function signalNetsFromPorts(
  ports: ExistingPort[], boardNets: string[], refNets: string[],
): string[] {
  const onBoard = new Set(boardNets)
  const refs = new Set(refNets)
  const out: string[] = []
  for (const port of ports) {
    if (!port.net || !onBoard.has(port.net) || refs.has(port.net)) continue
    if (!out.includes(port.net)) out.push(port.net)
  }
  return out
}

/** 提示用：既有 Port 掛在哪些元件上（去重、照字母排）。 */
export function portComponents(ports: ExistingPort[]): string[] {
  return [...new Set(ports.map(p => p.component).filter(Boolean))].sort()
}
