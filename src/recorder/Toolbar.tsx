import { useEffect, useState } from 'react'
import type { RecorderStatus } from '@shared/types'
import { api, formatTime } from '../lib/api'
import { Icon } from '../lib/icons'

export function Toolbar(): React.JSX.Element {
  const [status, setStatus] = useState<RecorderStatus>({ state: 'recording', elapsedMs: 0 })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.status().then(setStatus)
    return api.on('recorder:status', setStatus)
  }, [])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const paused = status.state === 'paused'
  return (
    <div className="toolbar drag">
      <span className={`dot rec ${paused ? 'paused' : ''}`} />
      <span className="time">{formatTime(status.elapsedMs)}</span>
      <div className="sep" />
      <button className="tb-btn no-drag" title={paused ? 'Resume (Ctrl+Shift+P)' : 'Pause (Ctrl+Shift+P)'} disabled={busy} onClick={() => run(paused ? api.resume : api.pause)}>
        {paused ? <Icon.play /> : <Icon.pause />}
      </button>
      <button className="tb-btn no-drag" title="Restart" disabled={busy} onClick={() => run(api.restart)}>
        <Icon.restart />
      </button>
      <button className="tb-btn no-drag" title="Discard" disabled={busy} onClick={() => run(api.discard)}>
        <Icon.trash />
      </button>
      <div style={{ flex: 1 }} />
      <button className="tb-stop no-drag" title="Stop (Ctrl+Shift+R)" disabled={busy} onClick={() => run(api.stop)}>
        <Icon.stop size={14} /> Stop
      </button>
    </div>
  )
}
