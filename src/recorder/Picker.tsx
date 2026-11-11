import { useEffect, useRef, useState } from 'react'
import type { DisplayInfo, Rect, RecordingOptions, Settings, SourceKind, WindowInfo } from '@shared/types'
import { api } from '../lib/api'
import { Icon } from '../lib/icons'

function useDevices(): { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[] } {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    const load = async (): Promise<void> => {
      // Labels are only exposed after a permission grant.
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true })
        s.getTracks().forEach((t) => t.stop())
      } catch {
        /* no microphone */
      }
      setDevices(await navigator.mediaDevices.enumerateDevices())
    }
    void load()
    navigator.mediaDevices.addEventListener('devicechange', load)
    return () => navigator.mediaDevices.removeEventListener('devicechange', load)
  }, [])
  return {
    mics: devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'),
    cams: devices.filter((d) => d.kind === 'videoinput')
  }
}

function MicMeter({ deviceId }: { deviceId: string | null }): React.JSX.Element {
  const [level, setLevel] = useState(0)
  useEffect(() => {
    if (!deviceId) return
    let stream: MediaStream | null = null
    let raf = 0
    const ctx = new AudioContext()
    void navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } }).then((s) => {
      stream = s
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(s).connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      const tick = (): void => {
        analyser.getFloatTimeDomainData(buf)
        let peak = 0
        for (const v of buf) peak = Math.max(peak, Math.abs(v))
        setLevel((l) => Math.max(peak, l * 0.85))
        raf = requestAnimationFrame(tick)
      }
      tick()
    })
    return () => {
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx.close()
    }
  }, [deviceId])
  return (
    <div className="meter">
      <div style={{ width: `${Math.min(100, level * 140)}%` }} />
    </div>
  )
}

export function Picker(): React.JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [kind, setKind] = useState<SourceKind>('display')
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [displayId, setDisplayId] = useState<number | null>(null)
  const [hwnd, setHwnd] = useState<string | null>(null)
  const [area, setArea] = useState<{ displayId: number; rect: Rect } | null>(null)
  const [starting, setStarting] = useState(false)
  const { mics, cams } = useDevices()
  const loaded = useRef(false)

  useEffect(() => {
    void api.getSettings().then(setSettings)
    void api.displays().then((d) => {
      setDisplays(d)
      setDisplayId((cur) => cur ?? d.find((x) => x.primary)?.id ?? d[0]?.id ?? null)
    })
  }, [])

  useEffect(() => {
    if (kind === 'window') void api.windows().then(setWindows)
  }, [kind])

  // Pick sensible devices once the list is known.
  useEffect(() => {
    if (!settings || loaded.current || (!mics.length && !cams.length)) return
    loaded.current = true
    const patch: Partial<Settings> = {}
    if (settings.micDeviceId && !mics.some((m) => m.deviceId === settings.micDeviceId)) patch.micDeviceId = mics[0]?.deviceId ?? null
    if (settings.cameraDeviceId && !cams.some((c) => c.deviceId === settings.cameraDeviceId)) patch.cameraDeviceId = null
    if (Object.keys(patch).length) update(patch)
    else if (settings.cameraDeviceId) void api.showBubble(settings.cameraDeviceId)
  }, [settings, mics, cams])

  const update = (patch: Partial<Settings>): void => {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    void api.setSettings(patch)
    if ('cameraDeviceId' in patch) {
      if (patch.cameraDeviceId) void api.showBubble(patch.cameraDeviceId)
      else void api.hideBubble()
    }
  }

  const chooseArea = async (): Promise<void> => {
    const r = await api.selectArea()
    if (r) setArea(r)
  }

  const ready = kind === 'display' ? displayId !== null : kind === 'window' ? hwnd !== null : area !== null

  const record = async (): Promise<void> => {
    if (!settings || !ready) return
    setStarting(true)
    const win = windows.find((w) => w.hwnd === hwnd)
    const source: RecordingOptions['source'] =
      kind === 'display'
        ? { kind: 'display', displayId: displayId! }
        : kind === 'window'
          ? { kind: 'window', hwnd: hwnd!, title: win?.title ?? '' }
          : { kind: 'area', displayId: area!.displayId, rect: area!.rect }
    await api.start({
      source,
      fps: settings.fps,
      micDeviceId: settings.micDeviceId,
      systemAudio: settings.systemAudio,
      cameraDeviceId: settings.cameraDeviceId,
      countdown: settings.countdown
    })
    setStarting(false)
  }

  if (!settings) return <div className="picker" />

  return (
    <div className="picker">
      <div className="picker-head drag">
        <span>New recording</span>
        <button className="btn ghost icon no-drag" onClick={() => api.closePicker()} title="Close">
          <Icon.close />
        </button>
      </div>
      <div className="picker-body">
        <div className="segmented">
          <button className={kind === 'display' ? 'on' : ''} onClick={() => setKind('display')}>
            Display
          </button>
          <button className={kind === 'window' ? 'on' : ''} onClick={() => setKind('window')}>
            Window
          </button>
          <button className={kind === 'area' ? 'on' : ''} onClick={() => setKind('area')}>
            Area
          </button>
        </div>

        <div className="source-list scroll">
          {kind === 'display' &&
            displays.map((d) => (
              <button key={d.id} className={`source ${displayId === d.id ? 'on' : ''}`} onClick={() => setDisplayId(d.id)}>
                {d.thumbnail ? <img src={d.thumbnail} /> : <div className="ph" />}
                <div className="name">
                  {d.label} {d.primary && <span className="faint">· main</span>}
                </div>
              </button>
            ))}
          {kind === 'window' &&
            (windows.length ? (
              windows.map((w) => (
                <button key={w.hwnd} className={`source ${hwnd === w.hwnd ? 'on' : ''}`} onClick={() => setHwnd(w.hwnd)} title={w.title}>
                  {w.thumbnail ? <img src={w.thumbnail} /> : <div className="ph" />}
                  <div className="name">
                    {w.icon && <img src={w.icon} />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.title}</span>
                  </div>
                </button>
              ))
            ) : (
              <div className="empty" style={{ gridColumn: 'span 2' }}>
                Looking for windows…
              </div>
            ))}
          {kind === 'area' && (
            <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn" onClick={chooseArea}>
                <Icon.area /> {area ? 'Select a different area' : 'Select area on screen'}
              </button>
              {area && (
                <div className="muted" style={{ textAlign: 'center' }}>
                  {Math.round(area.rect.width)} × {Math.round(area.rect.height)} at ({Math.round(area.rect.x)}, {Math.round(area.rect.y)})
                </div>
              )}
            </div>
          )}
        </div>

        <div className="device-row">
          <div className={`ic ${settings.micDeviceId ? 'on' : ''}`}>
            <Icon.mic />
          </div>
          <div style={{ flex: 1 }}>
            <select className="select" value={settings.micDeviceId ?? ''} onChange={(e) => update({ micDeviceId: e.target.value || null })}>
              <option value="">No microphone</option>
              {mics.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label || 'Microphone'}
                </option>
              ))}
            </select>
            {settings.micDeviceId && <MicMeter deviceId={settings.micDeviceId} />}
          </div>
        </div>
        <div className="device-row">
          <div className={`ic ${settings.cameraDeviceId ? 'on' : ''}`}>
            <Icon.camera />
          </div>
          <select className="select" value={settings.cameraDeviceId ?? ''} onChange={(e) => update({ cameraDeviceId: e.target.value || null })}>
            <option value="">No camera</option>
            {cams.map((c) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label || 'Camera'}
              </option>
            ))}
          </select>
        </div>
        <div className="device-row">
          <div className={`ic ${settings.systemAudio ? 'on' : ''}`}>
            <Icon.speaker />
          </div>
          <div style={{ flex: 1 }}>System audio</div>
          <button className={`switch ${settings.systemAudio ? 'on' : ''}`} onClick={() => update({ systemAudio: !settings.systemAudio })} />
        </div>

        <div style={{ display: 'flex', gap: 10, margin: '6px 0 14px', alignItems: 'center' }}>
          <div className="segmented" style={{ width: 120 }}>
            {([30, 60] as const).map((f) => (
              <button key={f} className={settings.fps === f ? 'on' : ''} onClick={() => update({ fps: f })}>
                {f} fps
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <span className="muted">Countdown</span>
          <button className={`switch ${settings.countdown ? 'on' : ''}`} onClick={() => update({ countdown: !settings.countdown })} />
        </div>

        <button className="record-btn" disabled={!ready || starting} onClick={record}>
          <span className="dot" /> {starting ? 'Starting…' : 'Start recording'}
        </button>
        <div className="faint" style={{ textAlign: 'center', marginTop: 8, fontSize: 11 }}>
          <span className="kbd">Ctrl</span> + <span className="kbd">Shift</span> + <span className="kbd">R</span> to start / stop
        </div>
      </div>
    </div>
  )
}
