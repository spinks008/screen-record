import { useEffect, useState } from 'react'
import type { Aspect, Corner, EditState, Preset, Settings, Style } from '@shared/types'
import { GRADIENTS, SOLID_COLORS, defaultStyle } from '../engine/defaults'
import { generateAutoZooms, newId } from '../engine/autoZoom'
import { api } from '../lib/api'
import { Icon } from '../lib/icons'
import { useEditor } from './store'

type Tab = 'style' | 'cursor' | 'camera' | 'keys' | 'audio'

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <div className="field">
      <div className="label">
        <span>{props.label}</span>
        <span className="value">{props.format ? props.format(props.value) : props.value}</span>
      </div>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 0.01} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </div>
  )
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <div className="switch-row">
      <span>{label}</span>
      <button className={`switch ${value ? 'on' : ''}`} onClick={() => onChange(!value)} />
    </div>
  )
}

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }): React.JSX.Element {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const pct = (v: number): string => `${Math.round(v * 100)}%`

export function Inspector(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('style')
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)
  const style = project.edit.style
  const edit = useEditor((s) => s.edit)
  const setStyle = (fn: (s: Style) => void, key?: string): void => edit((d) => fn(d.style), key)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'style', label: 'Frame' },
    { id: 'cursor', label: 'Cursor' },
    { id: 'camera', label: 'Camera' },
    { id: 'keys', label: 'Keys' },
    { id: 'audio', label: 'Audio' }
  ]

  return (
    <div className="inspector">
      {selection && <SelectionPanel />}
      <div className="insp-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="insp-body scroll">
        {tab === 'style' && <FramePanel style={style} setStyle={setStyle} projectId={project.id} />}
        {tab === 'cursor' && (
          <>
            <Toggle label="Show cursor" value={style.cursor.visible} onChange={(v) => setStyle((s) => void (s.cursor.visible = v))} />
            <Slider label="Size" value={style.cursor.size} min={0.6} max={4} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => setStyle((s) => void (s.cursor.size = v), 'cursor-size')} />
            <div className="field">
              <div className="label">Smoothing</div>
              <Segmented
                value={style.cursor.smoothing}
                options={[
                  { value: 'off', label: 'Off' },
                  { value: 'slow', label: 'Slow' },
                  { value: 'fast', label: 'Fast' },
                  { value: 'rapid', label: 'Rapid' }
                ]}
                onChange={(v) => setStyle((s) => void (s.cursor.smoothing = v))}
              />
            </div>
            <Toggle label="Hide when idle" value={style.cursor.hideIdle} onChange={(v) => setStyle((s) => void (s.cursor.hideIdle = v))} />
            {style.cursor.hideIdle && (
              <Slider label="Idle after" value={style.cursor.idleMs} min={500} max={8000} step={100} format={(v) => `${(v / 1000).toFixed(1)}s`} onChange={(v) => setStyle((s) => void (s.cursor.idleMs = v), 'idle')} />
            )}
            <Toggle label="Click effect" value={style.cursor.clickEffect} onChange={(v) => setStyle((s) => void (s.cursor.clickEffect = v))} />
            <Toggle label="Return to start at the end (loop)" value={style.cursor.loopToStart} onChange={(v) => setStyle((s) => void (s.cursor.loopToStart = v))} />
          </>
        )}
        {tab === 'camera' &&
          (project.files.camera ? (
            <>
              <Toggle label="Show camera" value={style.camera.visible} onChange={(v) => setStyle((s) => void (s.camera.visible = v))} />
              <div className="field">
                <div className="label">Shape</div>
                <Segmented
                  value={style.camera.shape}
                  options={[
                    { value: 'circle', label: 'Circle' },
                    { value: 'rounded', label: 'Rounded' },
                    { value: 'square', label: 'Square' }
                  ]}
                  onChange={(v) => setStyle((s) => void (s.camera.shape = v))}
                />
              </div>
              <Slider label="Size" value={style.camera.size} min={0.1} max={0.5} format={pct} onChange={(v) => setStyle((s) => void (s.camera.size = v), 'cam-size')} />
              <div className="field">
                <div className="label">Position</div>
                <div className="corner-grid">
                  {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as Corner[]).map((c) => (
                    <button key={c} className={style.camera.corner === c ? 'on' : ''} onClick={() => setStyle((s) => void (s.camera.corner = c))}>
                      <span className={`corner-dot ${c}`} />
                    </button>
                  ))}
                </div>
              </div>
              <Toggle label="Mirror" value={style.camera.mirror} onChange={(v) => setStyle((s) => void (s.camera.mirror = v))} />
              <p className="faint">Use the Camera button on the timeline to hide the camera or make it fullscreen for part of the video.</p>
            </>
          ) : (
            <div className="empty">This recording has no camera. Pick a camera in the recorder to add a webcam overlay.</div>
          ))}
        {tab === 'keys' && (
          <>
            <Toggle label="Show keystrokes" value={style.keys.enabled} onChange={(v) => setStyle((s) => void (s.keys.enabled = v))} />
            <div className="field">
              <div className="label">Show</div>
              <Segmented
                value={style.keys.mode}
                options={[
                  { value: 'combos', label: 'Shortcuts only' },
                  { value: 'all', label: 'All typing' }
                ]}
                onChange={(v) => setStyle((s) => void (s.keys.mode = v))}
              />
            </div>
            <p className="faint">Shortcuts like Ctrl + C appear as a pill at the bottom of the video.</p>
          </>
        )}
        {tab === 'audio' && (
          <>
            {project.files.mic ? (
              <>
                <Toggle label="Microphone" value={!style.audio.mic.muted} onChange={(v) => setStyle((s) => void (s.audio.mic.muted = !v))} />
                <Slider label="Mic volume" value={style.audio.mic.volume} min={0} max={2} format={pct} onChange={(v) => setStyle((s) => void (s.audio.mic.volume = v), 'mic-vol')} />
              </>
            ) : (
              <p className="faint">No microphone track.</p>
            )}
            {project.files.system ? (
              <>
                <Toggle label="System audio" value={!style.audio.system.muted} onChange={(v) => setStyle((s) => void (s.audio.system.muted = !v))} />
                <Slider label="System volume" value={style.audio.system.volume} min={0} max={2} format={pct} onChange={(v) => setStyle((s) => void (s.audio.system.volume = v), 'sys-vol')} />
              </>
            ) : (
              <p className="faint">No system audio track.</p>
            )}
          </>
        )}
      </div>
      <PresetBar />
    </div>
  )
}

function FramePanel({ style, setStyle, projectId }: { style: Style; setStyle: (fn: (s: Style) => void, key?: string) => void; projectId: string }): React.JSX.Element {
  const bg = style.background
  return (
    <>
      <div className="field">
        <div className="label">Background</div>
        <Segmented
          value={bg.kind}
          options={[
            { value: 'gradient', label: 'Gradient' },
            { value: 'color', label: 'Color' },
            { value: 'wallpaper', label: 'Wallpaper' },
            { value: 'image', label: 'Image' }
          ]}
          onChange={async (v) => {
            if (v === 'image') {
              const url = await api.importImage(projectId)
              if (url) setStyle((s) => void (s.background = { kind: 'image', value: url, blur: s.background.blur }))
              return
            }
            setStyle((s) => {
              s.background.kind = v
              if (v === 'gradient') s.background.value = GRADIENTS[0].id
              if (v === 'color') s.background.value = SOLID_COLORS[0]
              if (v === 'wallpaper') s.background.value = 'media://wallpaper/current'
            })
          }}
        />
      </div>
      {bg.kind === 'gradient' && (
        <div className="swatches">
          {GRADIENTS.map((g) => (
            <button
              key={g.id}
              title={g.name}
              className={`swatch ${bg.value === g.id ? 'on' : ''}`}
              style={{ background: `linear-gradient(${g.angle}deg, ${g.stops.join(', ')})` }}
              onClick={() => setStyle((s) => void (s.background.value = g.id))}
            />
          ))}
        </div>
      )}
      {bg.kind === 'color' && (
        <div className="swatches">
          {SOLID_COLORS.map((c) => (
            <button key={c} className={`swatch ${bg.value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setStyle((s) => void (s.background.value = c))} />
          ))}
          <input type="color" className="swatch" value={bg.value.startsWith('#') ? bg.value : '#000000'} onChange={(e) => setStyle((s) => void (s.background.value = e.target.value), 'bg-color')} />
        </div>
      )}
      {(bg.kind === 'image' || bg.kind === 'wallpaper') && (
        <Slider label="Background blur" value={bg.blur} min={0} max={1} format={pct} onChange={(v) => setStyle((s) => void (s.background.blur = v), 'bg-blur')} />
      )}
      {bg.kind === 'image' && (
        <button
          className="btn sm"
          style={{ marginBottom: 14 }}
          onClick={async () => {
            const url = await api.importImage(projectId)
            if (url) setStyle((s) => void (s.background.value = url))
          }}
        >
          <Icon.image size={14} /> Choose another image
        </button>
      )}

      <div className="field">
        <div className="label">Aspect ratio</div>
        <select className="select" value={style.aspect} onChange={(e) => setStyle((s) => void (s.aspect = e.target.value as Aspect))}>
          <option value="auto">Auto (match recording)</option>
          <option value="16:9">16:9 · YouTube</option>
          <option value="9:16">9:16 · Reels, Shorts, TikTok</option>
          <option value="1:1">1:1 · Square</option>
          <option value="4:5">4:5 · Feed</option>
          <option value="4:3">4:3</option>
        </select>
      </div>
      <Slider label="Padding" value={style.padding} min={0} max={0.25} format={pct} onChange={(v) => setStyle((s) => void (s.padding = v), 'padding')} />
      <Slider label="Corner radius" value={style.radius} min={0} max={48} step={1} format={(v) => `${v}px`} onChange={(v) => setStyle((s) => void (s.radius = v), 'radius')} />
      <Slider label="Shadow" value={style.shadow} min={0} max={1} format={pct} onChange={(v) => setStyle((s) => void (s.shadow = v), 'shadow')} />
      <Slider label="Motion blur" value={style.motionBlur} min={0} max={1} format={pct} onChange={(v) => setStyle((s) => void (s.motionBlur = v), 'mblur')} />

      <div className="field">
        <div className="label">
          <span>
            <Icon.crop size={12} /> Crop
          </span>
          <button className="link" onClick={() => setStyle((s) => void (s.crop = { x: 0, y: 0, width: 1, height: 1 }))}>
            Reset
          </button>
        </div>
        <CropControls style={style} setStyle={setStyle} />
      </div>
    </>
  )
}

function CropControls({ style, setStyle }: { style: Style; setStyle: (fn: (s: Style) => void, key?: string) => void }): React.JSX.Element {
  const c = style.crop
  const left = c.x
  const top = c.y
  const right = 1 - c.x - c.width
  const bottom = 1 - c.y - c.height
  const set = (side: 'left' | 'top' | 'right' | 'bottom', v: number): void =>
    setStyle((s) => {
      const l = side === 'left' ? v : left
      const t = side === 'top' ? v : top
      const r = side === 'right' ? v : right
      const b = side === 'bottom' ? v : bottom
      if (1 - l - r < 0.1 || 1 - t - b < 0.1) return
      s.crop = { x: l, y: t, width: 1 - l - r, height: 1 - t - b }
    }, `crop-${side}`)
  return (
    <div className="crop-grid">
      {(
        [
          ['left', left],
          ['right', right],
          ['top', top],
          ['bottom', bottom]
        ] as const
      ).map(([side, v]) => (
        <label key={side}>
          <span className="faint">{side}</span>
          <input type="range" min={0} max={0.45} step={0.005} value={v} onChange={(e) => set(side, Number(e.target.value))} />
        </label>
      ))}
    </div>
  )
}

function SelectionPanel(): React.JSX.Element | null {
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)!
  const edit = useEditor((s) => s.edit)
  const select = useEditor((s) => s.select)
  const list = project.edit[selection.track] as { id: string }[]
  const seg = list.find((s) => s.id === selection.id) as any
  if (!seg) return null
  const update = (fn: (s: any) => void, key?: string): void =>
    edit((d) => {
      const s = (d[selection.track] as { id: string }[]).find((x) => x.id === selection.id)
      if (s) fn(s)
    }, key)
  const remove = (): void => {
    edit((d) => {
      ;(d as any)[selection.track] = (d[selection.track] as { id: string }[]).filter((x) => x.id !== selection.id)
    })
    select(null)
  }
  const titles: Record<string, string> = { zooms: 'Zoom', cuts: 'Cut', speeds: 'Speed', masks: 'Mask', cameraSegments: 'Camera layout' }
  return (
    <div className="sel-panel">
      <div className="sel-head">
        <b>{titles[selection.track]}</b>
        <span className="faint">
          {(seg.start / 1000).toFixed(1)}s – {(seg.end / 1000).toFixed(1)}s
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={remove} title="Delete (Del)">
          <Icon.trash size={13} />
        </button>
        <button className="btn ghost sm" onClick={() => select(null)} title="Close">
          <Icon.close size={13} />
        </button>
      </div>
      {selection.track === 'zooms' && (
        <>
          <Slider label="Zoom level" value={seg.zoom} min={1.1} max={4} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => update((s) => {
            s.zoom = v
            s.auto = false
          }, `zoom-${seg.id}`)} />
          <div className="field">
            <div className="label">Focus</div>
            <Segmented
              value={seg.mode}
              options={[
                { value: 'follow', label: 'Follow cursor' },
                { value: 'fixed', label: 'Fixed point' }
              ]}
              onChange={(v) => update((s) => void (s.mode = v))}
            />
          </div>
          {seg.mode === 'fixed' && <p className="faint">Drag the target on the preview to choose where to zoom.</p>}
        </>
      )}
      {selection.track === 'speeds' && (
        <div className="field">
          <div className="label">Speed</div>
          <Segmented
            value={seg.speed}
            options={[0.5, 1.5, 2, 3, 4, 8].map((v) => ({ value: v, label: `${v}×` }))}
            onChange={(v) => update((s) => void (s.speed = v))}
          />
        </div>
      )}
      {selection.track === 'masks' && (
        <>
          <div className="field">
            <div className="label">Effect</div>
            <Segmented
              value={seg.kind}
              options={[
                { value: 'blur', label: 'Blur' },
                { value: 'highlight', label: 'Highlight' }
              ]}
              onChange={(v) => update((s) => void (s.kind = v))}
            />
          </div>
          <p className="faint">Drag the box on the preview to move it; drag its corner to resize.</p>
        </>
      )}
      {selection.track === 'cameraSegments' && (
        <div className="field">
          <div className="label">Layout</div>
          <Segmented
            value={seg.layout}
            options={[
              { value: 'fullscreen', label: 'Fullscreen' },
              { value: 'hidden', label: 'Hidden' }
            ]}
            onChange={(v) => update((s) => void (s.layout = v))}
          />
        </div>
      )}
      {selection.track === 'cuts' && <p className="faint">This part is removed from the export. Drag the edges to adjust.</p>}
    </div>
  )
}

function PresetBar(): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const events = useEditor((s) => s.events)
  const edit = useEditor((s) => s.edit)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  useEffect(() => void api.getSettings().then(setSettings), [])

  const apply = (style: Style): void =>
    edit((d) => {
      // Keep project-specific choices (crop, background image) sensible.
      d.style = { ...structuredClone(style), crop: d.style.crop }
      if (!project.files.camera) d.style.camera.visible = false
    })

  const save = async (): Promise<void> => {
    if (!settings || !name.trim()) return
    const preset: Preset = { id: newId('preset'), name: name.trim(), style: structuredClone(project.edit.style) }
    setSettings(await api.setSettings({ presets: [...settings.presets, preset] }))
    setNaming(false)
    setName('')
  }

  const regenerate = (): void =>
    edit((d: EditState) => {
      const manual = d.zooms.filter((z) => !z.auto)
      const auto = generateAutoZooms(events, project.durationMs, project.capture).filter(
        (a) => !manual.some((m) => a.start < m.end && a.end > m.start)
      )
      d.zooms = [...manual, ...auto].sort((a, b) => a.start - b.start)
    })

  return (
    <div className="preset-bar">
      {naming ? (
        <form
          style={{ display: 'flex', gap: 6, flex: 1 }}
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input className="input" autoFocus placeholder="Preset name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn sm primary" type="submit">
            Save
          </button>
        </form>
      ) : (
        <>
          <select
            className="select"
            value=""
            onChange={(e) => {
              if (e.target.value === '__default') return apply(defaultStyle())
              const p = settings?.presets.find((x) => x.id === e.target.value)
              if (p) apply(p.style)
            }}
          >
            <option value="">Apply preset…</option>
            <option value="__default">Built-in default</option>
            {settings?.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn sm" onClick={() => setNaming(true)} title="Save current style as a preset">
            <Icon.plus size={13} /> Save
          </button>
          <button className="btn sm" onClick={regenerate} title="Re-create automatic zooms from clicks (keeps your manual zooms)">
            <Icon.sparkles size={13} />
          </button>
        </>
      )}
    </div>
  )
}
