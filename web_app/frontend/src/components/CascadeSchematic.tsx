// 串接電路示意圖（純 SVG）— 功能3：解算前即可預覽 N 段接線
// 資料契約與後端 /api/cascade/preview 一致；外部檔案模式由前端自組相同結構。
// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供

export interface CascadeGraph {
  blocks: { label: string; sub_label?: string; ports: string[]; solved?: boolean }[]
  connections: { a: { block: number; port: string }; b: { block: number; port: string }; net?: string; stripline?: boolean }[]
  shorts: { block: number; ports: string[] }[]
}

interface Props {
  graph: CascadeGraph
}

const BLOCK_W = 170
const GAP_X = 110
const PIN_DY = 20
const TOP_PIN_DX = 26
const MARGIN = { x: 30, top: 66, bottom: 24 }

const NET_COLORS = ['#00e5ff', '#7ee787', '#ff8c00', '#e040fb', '#ffd600', '#ff5252', '#18ffff', '#c6ff00']
const netColor = (net: string) => {
  let h = 0
  for (const ch of net) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return NET_COLORS[h % NET_COLORS.length]
}

// pin 群：短路群組的多個 port 共用一個接點（顯示為小匯流排）
interface PinGroup { ports: string[]; side: 'left' | 'right' | 'top'; y: number; x: number }

export default function CascadeSchematic({ graph }: Props) {
  const { blocks, connections, shorts } = graph
  if (blocks.length === 0) {
    return <div style={{ padding: 40, color: 'var(--faint)', textAlign: 'center' }}>尚無串接資料</div>
  }

  // 1. 每個 block 把 port 歸入短路群（未在群組者自成一群）
  const groupsPerBlock: { key: string; ports: string[] }[][] = blocks.map((b, bi) => {
    const used = new Set<string>()
    const groups: { key: string; ports: string[] }[] = []
    for (const sh of shorts.filter(s => s.block === bi)) {
      const members = sh.ports.filter(p => b.ports.includes(p))
      if (members.length >= 2) {
        groups.push({ key: members.join('+'), ports: members })
        members.forEach(p => used.add(p))
      }
    }
    for (const p of b.ports) {
      if (!used.has(p)) groups.push({ key: p, ports: [p] })
    }
    return groups
  })

  const groupOf = (bi: number, port: string) =>
    groupsPerBlock[bi].find(g => g.ports.includes(port))?.key ?? port

  // 2. 依連線方向決定每群的邊：連往較大 block → right、較小 → left、無連線 → top
  const sideMap: Record<string, 'left' | 'right' | 'top'> = {}
  for (const c of connections) {
    const ka = `${c.a.block}|${groupOf(c.a.block, c.a.port)}`
    const kb = `${c.b.block}|${groupOf(c.b.block, c.b.port)}`
    if (c.a.block < c.b.block) { sideMap[ka] = 'right'; sideMap[kb] = 'left' }
    else if (c.a.block > c.b.block) { sideMap[ka] = 'left'; sideMap[kb] = 'right' }
  }

  // 3. 排 pin 位置
  const pinPos: Record<string, PinGroup> = {}
  let maxSidePins = 2
  blocks.forEach((_, bi) => {
    const left = groupsPerBlock[bi].filter(g => sideMap[`${bi}|${g.key}`] === 'left')
    const right = groupsPerBlock[bi].filter(g => sideMap[`${bi}|${g.key}`] === 'right')
    maxSidePins = Math.max(maxSidePins, left.length, right.length)
  })
  const blockH = Math.max(70, maxSidePins * PIN_DY + 34)
  const blockY = MARGIN.top

  blocks.forEach((_, bi) => {
    const x0 = MARGIN.x + bi * (BLOCK_W + GAP_X)
    const left = groupsPerBlock[bi].filter(g => sideMap[`${bi}|${g.key}`] === 'left')
    const right = groupsPerBlock[bi].filter(g => sideMap[`${bi}|${g.key}`] === 'right')
    const top = groupsPerBlock[bi].filter(g => !sideMap[`${bi}|${g.key}`])
    left.forEach((g, i) => {
      pinPos[`${bi}|${g.key}`] = { ports: g.ports, side: 'left', x: x0, y: blockY + 24 + i * PIN_DY }
    })
    right.forEach((g, i) => {
      pinPos[`${bi}|${g.key}`] = { ports: g.ports, side: 'right', x: x0 + BLOCK_W, y: blockY + 24 + i * PIN_DY }
    })
    top.forEach((g, i) => {
      pinPos[`${bi}|${g.key}`] = {
        ports: g.ports, side: 'top',
        x: x0 + 16 + (i % 6) * TOP_PIN_DX, y: blockY - 6 - Math.floor(i / 6) * 14,
      }
    })
  })

  const svgW = MARGIN.x * 2 + blocks.length * BLOCK_W + (blocks.length - 1) * GAP_X
  const svgH = blockY + blockH + MARGIN.bottom

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', height: '100%', background: '#0c0e12' }}>
      <svg width={svgW} height={svgH} style={{ display: 'block', margin: '0 auto', minWidth: svgW }}>
        {/* 連線（先畫，讓方塊蓋在上面）*/}
        {connections.map((c, ci) => {
          const pa = pinPos[`${c.a.block}|${groupOf(c.a.block, c.a.port)}`]
          const pb = pinPos[`${c.b.block}|${groupOf(c.b.block, c.b.port)}`]
          if (!pa || !pb) return null
          const color = netColor(c.net || c.a.port)
          const midX = (pa.x + pb.x) / 2
          const d = `M ${pa.x} ${pa.y} C ${midX} ${pa.y}, ${midX} ${pb.y}, ${pb.x} ${pb.y}`
          return (
            <g key={ci}>
              <path d={d} fill="none" stroke={color} strokeWidth={c.stripline ? 2.4 : 1.6} />
              {c.net && (
                <text x={midX} y={(pa.y + pb.y) / 2 - 5} fill={color} fontSize={9}
                  textAnchor="middle">{c.net}{c.stripline ? '（T+B 短路）' : ''}</text>
              )}
            </g>
          )
        })}

        {/* 方塊與 pin */}
        {blocks.map((b, bi) => {
          const x0 = MARGIN.x + bi * (BLOCK_W + GAP_X)
          return (
            <g key={bi}>
              <rect x={x0} y={blockY} width={BLOCK_W} height={blockH} rx={8}
                fill="rgba(30,38,50,0.95)"
                stroke={b.solved === false ? 'var(--warn, #e3b341)' : '#4f83cc'}
                strokeWidth={1.4}
                strokeDasharray={b.solved === false ? '5 4' : undefined} />
              <text x={x0 + BLOCK_W / 2} y={blockY + 15} fill="#e6edf3" fontSize={12}
                fontWeight={700} textAnchor="middle">{b.label}</text>
              {b.sub_label && (
                <text x={x0 + BLOCK_W / 2} y={blockY + blockH - 8} fill="#5c677d"
                  fontSize={8} textAnchor="middle">{b.sub_label}
                  {b.solved === false ? '（未解）' : ''}</text>
              )}
              {groupsPerBlock[bi].map(g => {
                const pin = pinPos[`${bi}|${g.key}`]
                if (!pin) return null
                const isBus = g.ports.length > 1
                const labelText = isBus ? `${g.ports.length} 短路` : g.ports[0]
                return (
                  <g key={g.key}>
                    <circle cx={pin.x} cy={pin.y} r={isBus ? 4 : 3}
                      fill={isBus ? '#ffd600' : '#9fb0c3'} />
                    {pin.side === 'left' && (
                      <text x={pin.x + 7} y={pin.y + 3} fill="#9fb0c3" fontSize={8.5}>
                        {trimName(labelText)}<title>{g.ports.join(' + ')}</title>
                      </text>
                    )}
                    {pin.side === 'right' && (
                      <text x={pin.x - 7} y={pin.y + 3} fill="#9fb0c3" fontSize={8.5}
                        textAnchor="end">
                        {trimName(labelText)}<title>{g.ports.join(' + ')}</title>
                      </text>
                    )}
                    {pin.side === 'top' && (
                      <g>
                        <line x1={pin.x} y1={pin.y} x2={pin.x} y2={blockY}
                          stroke="#9fb0c3" strokeWidth={1} />
                        <text x={pin.x} y={pin.y - 4} fill="#7ee787" fontSize={8}
                          textAnchor="middle" transform={`rotate(-38 ${pin.x} ${pin.y - 4})`}>
                          {trimName(g.ports[0], 18)}<title>{g.ports.join(' + ')}</title>
                        </text>
                      </g>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

const trimName = (s: string, max = 14) =>
  s.length > max ? s.slice(0, max - 1) + '…' : s
