import { messagesFor } from './i18n/catalog'

/** 唯讀外框預覽：停止要求送達後仍等後端安全檢查點確認終止。 */
export async function runBoundaryPreviewJob(
  api: (path: string, body?: any) => Promise<any>,
  payload: Record<string, unknown>,
  callbacks: {
    started: (job: { job_id: string; started_at?: number }) => void
    state?: (state: any) => void
    wait?: () => Promise<void>
  },
): Promise<any | null> {
  const started = await api('/api/cutout/preview_boundary/start', payload)
  callbacks.started(started)
  const wait = callbacks.wait || (() => new Promise<void>(resolve => setTimeout(resolve, 1000)))
  for (;;) {
    await wait()
    let state: any
    try {
      state = await api(`/api/cutout/status?job_id=${encodeURIComponent(started.job_id)}`)
    } catch {
      // 斷線不代表 EDB 工作已終止；保留工作身分與停止入口，恢復後繼續確認。
      continue
    }
    callbacks.state?.(state)
    if (state.status === 'cancelled') return null
    if (state.status === 'error') {
      const message = messagesFor('zh-TW').publicUi.previewFailed
      const error = Object.assign(new Error(message), {
        user_safe: true, detail: message,
        detail_en: messagesFor('en').publicUi.previewFailed,
        event_id: state.event_id,
      })
      throw error
    }
    if (state.status === 'done') {
      if (!state.result) throw new Error('Missing preview result')
      return state.result
    }
  }
}
