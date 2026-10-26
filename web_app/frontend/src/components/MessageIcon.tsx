// 訊息視窗的類型圖示（ 驗收發現 B）。
//
// 原本是在文字前面加 ⚠／ℹ 字元，跟內文一樣小，而且成功訊息也掛著 ⚠。
// 改成內嵌 SVG：大小固定、顏色依類型，不靠字型有沒有那個符號。
import type { MessageKind } from '../messageDialog'

export const MESSAGE_KIND_COLOR: Record<MessageKind, string> = {
  info: '#4ea1ff',
  success: '#2fbf71',
  warning: '#f0b429',
  error: '#f25f5c',
}

export default function MessageIcon({ kind, size = 30 }: { kind: MessageKind; size?: number }) {
  const color = MESSAGE_KIND_COLOR[kind]
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const,
    focusable: false as const, 'data-kind': kind, style: { flex: 'none', display: 'block' } }
  if (kind === 'warning') {
    return (
      <svg {...common}>
        <path d="M12 2.5 22.5 21h-21z" fill={color} stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M12 9v5.5" stroke="#1b2433" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="12" cy="17.6" r="1.3" fill="#1b2433" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="10.5" fill={color} />
      {kind === 'success' && (
        <path d="M7 12.5l3.2 3.2L17.2 8.6" fill="none" stroke="#fff" strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round" />
      )}
      {kind === 'error' && (
        <path d="M8.3 8.3l7.4 7.4M15.7 8.3l-7.4 7.4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      )}
      {kind === 'info' && <>
        <circle cx="12" cy="7.4" r="1.4" fill="#fff" />
        <path d="M12 11v6.2" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
      </>}
    </svg>
  )
}
