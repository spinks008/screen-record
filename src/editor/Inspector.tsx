import { useEffect, useMemo, useState } from 'react'
import type { Aspect, ClickEffect, Corner, EditState, MotionPreset, MotionSettings, Preset, Settings, SpringConfig, Style } from '@shared/types'
import { GRADIENTS, MESHES, SOLID_COLORS, defaultStyle, type MeshPreset } from '../engine/defaults'
import { generateAutoZooms, newId } from '../engine/autoZoom'
import { CURSOR_PRESETS, SCREEN_PRESETS, motionFromPreset } from '../engine/spring'
import { CURSOR_ART_STYLES, cursorArt } from '../engine/cursorArt'
import { api } from '../lib/api'
import { Icon } from '../lib/icons'
import { useEditor } from './store'

type Tab = 'style' | 'cursor' | 'motion' | 'camera' | 'keys' | 'audio'

function Group({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }): React.JSX.Element {
  return (
    <details className="group" open={open}>
      <summary>{title}</summary>
      <div className="group-body">{children}</div>
    </details>
  )
}

/** CSS approximation of a mesh wallpaper, for its swatch. */
function meshCss(m: MeshPreset): string {
  const blobs = m.blobs.map((b) => `radial-gradient(circle at ${b.x * 100}% ${b.y * 100}%, ${b.color} 0, transparent ${Math.round(b.r * 120)}%)`)
  return [...blobs, m.base].join(', ')
}

const PRESET_LABELS: { value: MotionPreset; label: string }[] = [
  { value: 'slow', label: 'Slow' },
  { value: 'medium', label: 'Medium' },
  { value: 'quick', label: 'Quick' },
  { value: 'rapid', label: 'Rapid' }
]

/** Tension / friction / mass sliders; editing any of them makes the preset 'custom'. */
function SpringSliders({ value, onChange }: { value: MotionSettings; onChange: (s: SpringConfig) => void }): React.JSX.Element {
  const set = (patch: Partial<SpringConfig>): void => onChange({ tension: value.tension, friction: value.friction, mass: value.mass, ...patch })
  return (
    <>
      <Slider label="Tension · how fast it accelerates" value={value.tension} min={10} max={1000} step={5} format={(v) => String(Math.round(v))} onChange={(v) => set({ tension: v })} />
      <Slider label="Friction · how much it resists overshooting" value={value.friction} min={1} max={100} step={0.5} format={(v) => v.toFixed(1)} onChange={(v) => set({ friction: v })} />
      <Slider label="Mass · weight and momentum" value={value.mass} min={0.2} max={5} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set({ mass: v })} />
    </>
  )
}

type SetStyle = (fn: (s: Style) => void, key?: string) => void

function CursorPanel({ style, setStyle }: { style: Style; setStyle: SetStyle }): React.JSX.Element {
  const cs = style.cursor
  // Arrow thumbnails for each look, rendered once.
  const thumbs = useMemo(() => Object.fromEntries(CURSOR_ART_STYLES.map((a) => [a.id, cursorArt(a.id).arrow.canvas.toDataURL()])), [])
  return (
    <>
      <Toggle label="Show cursor" value={cs.visible} onChange={(v) => setStyle((s) => void (s.cursor.visible = v))} />
      <Slider label="Size" value={cs.size} min={0.6} max={4} format={(v) => `${v.toFixed(1)}×`} onChange={(v) => setStyle((s) => void (s.cursor.size = v), 'cursor-size')} />
      <div className="field">
        <div className="label">Style</div>
        <div className="art-grid">
          {CURSOR_ART_STYLES.map((a) => (
            <button key={a.id} title={a.label} className={cs.art === a.id ? 'on' : ''} onClick={() => setStyle((s) => void (s.cursor.art = a.id))}>
              <img src={thumbs[a.id]} alt={a.label} />
            </button>
          ))}
        </div>
      </div>
      <Toggle label="Always use the arrow" value={cs.alwaysArrow} onChange={(v) => setStyle((s) => void (s.cursor.alwaysArrow = v))} />
      {!cs.alwaysArrow && (
        <Slider label="Ignore shape changes shorter than" value={cs.typeHoldMs} min={0} max={600} step={10} format={(v) => `${Math.round(v)} ms`} onChange={(v) => setStyle((s) => void (s.cursor.typeHoldMs = v), 'type-hold')} />
      )}
      <Toggle label="Hide when not moving" value={cs.hideIdle} onChange={(v) => setStyle((s) => void (s.cursor.hideIdle = v))} />
      {cs.hideIdle && (
        <Slider label="Hide after" value={cs.idleMs} min={500} max={8000} step={100} format={(v) => `${(v / 1000).toFixed(1)}s`} onChange={(v) => setStyle((s) => void (s.cursor.idleMs = v), 'idle')} />
      )}
      <div className="field">
        <div className="label">Click effect</div>
        <Segmented<ClickEffect>
          value={cs.clickEffect}
          options={[
            { value: 'none', label: 'None' },
            { value: 'circle', label: 'Circle' },
            { value: 'ripple', label: 'Ripple' }
          ]}
          onChange={(v) => setStyle((s) => void (s.cursor.clickEffect = v))}
        />
      </div>
      <Toggle label="Click sound" value={cs.clickSound.enabled} onChange={(v) => setStyle((s) => void (s.cursor.clickSound.enabled = v))} />
      {cs.clickSound.enabled && (
        <Slider label="Click volume" value={cs.clickSound.volume} min={0} max={1.5} format={pct} onChange={(v) => setStyle((s) => void (s.cursor.clickSound.volume = v), 'click-vol')} />
      )}
      <Toggle label="Return to start at the end (loop)" value={cs.loopToStart} onChange={(v) => setStyle((s) => void (s.cursor.loopToStart = v))} />
    </>
  )
}

function MotionPanel({ style, setStyle }: { style: Style; setStyle: SetStyle }): React.JSX.Element {
  const mb = style.motionBlur
  const setSpring = (which: 'cursor' | 'screen', cfg: SpringConfig): void =>
    setStyle((s) => void (s.motion[which] = { preset: 'custom', ...cfg }), `spring-${which}`)
  return (
    <>
      <div className="insp-section">Cursor movement</div>
      <div className="field">
        <Segmented<MotionPreset | 'off' | 'custom'>
          value={style.motion.cursor.preset}
          options={[{ value: 'off', label: 'Off' }, ...PRESET_LABELS]}
          onChange={(v) =>
            setStyle((s) => {
              if (v === 'off') s.motion.cursor.preset = 'off'
              else if (v !== 'custom') s.motion.cursor = motionFromPreset(CURSOR_PRESETS, v)
            })
          }
        />
      </div>
      {style.motion.cursor.preset !== 'off' && (
        <Group title={style.motion.cursor.preset === 'custom' ? 'Advanced (custom)' : 'Advanced'}>
          <SpringSliders value={style.motion.cursor} onChange={(c) => setSpring('cursor', c)} />
        </Group>
      )}

      <div className="insp-section">Zoom &amp; pan</div>
      <div className="field">
        <Segmented<MotionPreset | 'off' | 'custom'>
          value={style.motion.screen.preset}
          options={PRESET_LABELS}
          onChange={(v) => setStyle((s) => void (s.motion.screen = motionFromPreset(SCREEN_PRESETS, v === 'off' || v === 'custom' ? 'quick' : v)))}
        />
      </div>
      <Group title={style.motion.screen.preset === 'custom' ? 'Advanced (custom)' : 'Advanced'}>
        <SpringSliders value={style.motion.screen} onChange={(c) => setSpring('screen', c)} />
        <p className="faint">Low friction makes zooms bounce; the view still never leaves the recording.</p>
      </Group>

      <div className="insp-section">Motion blur</div>
      <Toggle label="Motion blur" value={mb.enabled} onChange={(v) => setStyle((s) => void (s.motionBlur.enabled = v))} />
      {mb.enabled && (
        <Group title="Advanced motion blur">
          <Slider label="Zooming in or out" value={mb.zoom} min={0} max={1} format={pct} onChange={(v) => setStyle((s) => void (s.motionBlur.zoom = v), 'mb-zoom')} />
          <Slider label="Panning while zoomed" value={mb.pan} min={0} max={1} format={pct} onChange={(v) => setStyle((s) => void (s.motionBlur.pan = v), 'mb-pan')} />
          <Slider label="Cursor" value={mb.cursor} min={0} max={1} format={pct} onChange={(v) => setStyle((s) => void (s.motionBlur.cursor = v), 'mb-cursor')} />
          <Slider label="Camera" value={mb.camera} min={0} max={1} format={pct} onChange={(v) => setStyle((s) => void (s.motionBlur.camera = v), 'mb-camera')} />
        </Group>
      )}
    </>
  )
}

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
    { id: 'motion', label: 'Motion' },
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
        {tab === 'cursor' && <CursorPanel style={style} setStyle={setStyle} />}
        {tab === 'motion' && <MotionPanel style={style} setStyle={setStyle} />}
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
              {style.camera.shape !== 'circle' && (
                <div className="field">
                  <div className="label">Proportions</div>
                  <Segmented
                    value={style.camera.aspect}
                    options={[
                      { value: 1, label: 'Square' },
                      { value: 0.5625, label: 'Portrait' },
                      { value: 0.75, label: '3:4' },
                      { value: 16 / 9, label: 'Wide' }
                    ]}
                    onChange={(v) => setStyle((s) => void (s.camera.aspect = v))}
                  />
                </div>
              )}
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
            { value: 'mesh', label: 'Wallpaper' },
            { value: 'gradient', label: 'Gradient' },
            { value: 'color', label: 'Color' },
            { value: 'wallpaper', label: 'Desktop' },
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
              if (v === 'mesh') s.background.value = MESHES[0].id
              if (v === 'gradient') s.background.value = GRADIENTS[0].id
              if (v === 'color') s.background.value = SOLID_COLORS[0]
              if (v === 'wallpaper') s.background.value = 'media://wallpaper/current'
            })
          }}
        />
      </div>
      {bg.kind === 'mesh' && (
        <div className="swatches">
          {MESHES.map((m) => (
            <button
              key={m.id}
              title={m.name}
              className={`swatch ${bg.value === m.id ? 'on' : ''}`}
              style={{ background: meshCss(m) }}
              onClick={() => setStyle((s) => void (s.background.value = m.id))}
            />
          ))}
        </div>
      )}
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
      {(bg.kind === 'image' || bg.kind === 'wallpaper' || bg.kind === 'mesh') && (
        <Slider label={bg.kind === 'mesh' ? 'Softness' : 'Background blur'} value={bg.blur} min={0} max={1} format={pct} onChange={(v) => setStyle((s) => void (s.background.blur = v), 'bg-blur')} />
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
      <Toggle label="Inset · a bezel around the screen" value={style.inset.enabled} onChange={(v) => setStyle((s) => void (s.inset.enabled = v))} />
      {style.inset.enabled && (
        <>
          <Slider label="Inset width" value={style.inset.width} min={2} max={40} step={1} format={(v) => `${v}px`} onChange={(v) => setStyle((s) => void (s.inset.width = v), 'inset-w')} />
          <div className="field">
            <div className="label">Inset color</div>
            <Segmented
              value={style.inset.color}
              options={[
                { value: 'rgba(255,255,255,0.16)', label: 'Glass' },
                { value: 'rgba(0,0,0,0.45)', label: 'Smoke' },
                { value: '#ffffff', label: 'White' },
                { value: '#0b0b0f', label: 'Black' }
              ]}
              onChange={(v) => setStyle((s) => void (s.inset.color = v))}
            />
          </div>
        </>
      )}
      <Slider label="Shadow" value={style.shadow.strength} min={0} max={1} format={pct} onChange={(v) => setStyle((s) => void (s.shadow.strength = v), 'shadow')} />
      {style.shadow.strength > 0 && (
        <Group title="Advanced shadow">
          <Slider label="Softness" value={style.shadow.blur} min={0} max={140} step={1} format={(v) => `${v}px`} onChange={(v) => setStyle((s) => void (s.shadow.blur = v), 'shadow-blur')} />
          <Slider label="Drop" value={style.shadow.offsetY} min={-20} max={60} step={1} format={(v) => `${v}px`} onChange={(v) => setStyle((s) => void (s.shadow.offsetY = v), 'shadow-y')} />
        </Group>
      )}

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
          <Slider label="Zoom scale" value={seg.zoom} min={1.1} max={4} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update((s) => {
            s.zoom = v
            s.auto = false
          }, `zoom-${seg.id}`)} />
          <div className="field">
            <div className="label">Zoom mode</div>
            <Segmented
              value={seg.mode}
              options={[
                { value: 'follow', label: 'Auto · follows cursor' },
                { value: 'fixed', label: 'Manual · fixed point' }
              ]}
              onChange={(v) => update((s) => void (s.mode = v))}
            />
          </div>
          {seg.mode === 'fixed' && <p className="faint">Drag the target on the preview to choose where to zoom.</p>}
          <Toggle label="Disable this zoom" value={!!seg.disabled} onChange={(v) => update((s) => void (s.disabled = v))} />
          <Group title="Advanced">
            <Slider label="Snap to edges" value={seg.snapEdges ?? 0} min={0} max={1} format={pct} onChange={(v) => update((s) => void (s.snapEdges = v), `snap-${seg.id}`)} />
            <p className="faint">Near an edge of the recording, the view snaps to it and may show a little of the background.</p>
          </Group>
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
