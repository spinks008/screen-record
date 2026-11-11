import { useEffect, useRef, useState } from 'react'
import type { EditState, Segment } from '@shared/types'
import { newId } from '../engine/autoZoom'
import { buildPieces, outputDuration } from '../engine/timeline'
import { formatTime } from '../lib/api'
import { Icon } from '../lib/icons'
import { useEditor, type SegmentTrack } from './store'

const LABEL_W = 96

interface TrackDef {
  track: SegmentTrack
  label: string
  className: string
  text: (s: any) => string
}

const TRACKS: TrackDef[] = [
  { track: 'zooms', label: 'Zoom', className: 'seg-zoom', text: (z) => `${Math.round(z.zoom * 100)}% ${z.mode === 'follow' ? 'auto' : 'manual'}${z.disabled ? ' · off' : ''}` },
  { track: 'speeds', label: 'Speed', className: 'seg-speed', text: (s) => `${s.speed}×` },
  { track: 'masks', label: 'Masks', className: 'seg-mask', text: (m) => (m.kind === 'blur' ? 'Blur' : 'Highlight') },
  { track: 'cameraSegments', label: 'Camera', className: 'seg-camera', text: (c) => (c.layout === 'hidden' ? 'Hidden' : 'Fullscreen') }
]

/** Inserts a new segment at the playhead, fitted into the free space of its track. */
export function addSegment(track: SegmentTrack, extra: Record<string, unknown>, length = 2500): string | null {
  const { project, time, edit, select } = useEditor.getState()
  if (!project) return null
  const list = project.edit[track] as Segment[]
  const dur = project.durationMs
  let start = Math.min(time, dur - 500)
  let end = Math.min(dur, start + length)
  const before = list.filter((s) => s.end <= time).sort((a, b) => b.end - a.end)[0]
  const after = list.filter((s) => s.start >= time).sort((a, b) => a.start - b.start)[0]
  if (list.some((s) => time >= s.start && time < s.end)) return null
  if (after) end = Math.min(end, after.start)
  if (before) start = Math.max(start, before.end)
  if (end - start < 200) return null
  const id = newId(track)
  edit((d) => {
    ;(d[track] as Segment[]).push({ id, start, end, ...extra } as Segment)
    ;(d[track] as Segment[]).sort((a, b) => a.start - b.start)
  })
  select({ track, id })
  return id
}

export function Timeline(): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const time = useEditor((s) => s.time)
  const playing = useEditor((s) => s.playing)
  const selection = useEditor((s) => s.selection)
  const { edit, select, setTime, setPlaying } = useEditor.getState()
  const scroller = useRef<HTMLDivElement>(null)
  const [pxPerSec, setPxPerSec] = useState(0)
  const [width, setWidth] = useState(800)
  const dur = project.durationMs

  useEffect(() => {
    const el = scroller.current!
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit the whole recording by default.
  const fitPx = Math.max(4, (width - LABEL_W - 24) / Math.max(1, dur / 1000))
  const pps = pxPerSec || fitPx
  const x = (ms: number): number => (ms / 1000) * pps
  const totalW = x(dur) + 40

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const px = x(time) + LABEL_W
    if (px > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = px - LABEL_W - 40
  }, [time, playing])

  const timeFromEvent = (e: { clientX: number }): number => {
    const el = scroller.current!
    const r = el.getBoundingClientRect()
    return ((e.clientX - r.left + el.scrollLeft - LABEL_W) / pps) * 1000
  }

  const scrub = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    setPlaying(false)
    setTime(timeFromEvent(e))
    const move = (ev: PointerEvent): void => setTime(timeFromEvent(ev))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Drag a segment body (move) or edge (resize), clamped between its neighbours. */
  const dragSegment = (track: SegmentTrack, seg: Segment, mode: 'move' | 'start' | 'end') => (e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0) return
    select({ track, id: seg.id })
    const list = (project.edit[track] as Segment[]).filter((s) => s.id !== seg.id)
    const lo = Math.max(0, ...list.filter((s) => s.end <= seg.start + 1).map((s) => s.end))
    const hi = Math.min(dur, ...list.filter((s) => s.start >= seg.end - 1).map((s) => s.start))
    const x0 = e.clientX
    const len = seg.end - seg.start
    const key = `drag-${seg.id}-${Date.now()}`
    const move = (ev: PointerEvent): void => {
      const dt = ((ev.clientX - x0) / pps) * 1000
      let start = seg.start
      let end = seg.end
      if (mode === 'move') {
        start = Math.max(lo, Math.min(hi - len, seg.start + dt))
        end = start + len
      } else if (mode === 'start') start = Math.max(lo, Math.min(seg.end - 200, seg.start + dt))
      else end = Math.min(hi, Math.max(seg.start + 200, seg.end + dt))
      edit((d) => {
        const s = (d[track] as Segment[]).find((v) => v.id === seg.id)
        if (!s) return
        s.start = Math.round(start)
        s.end = Math.round(end)
        if (track === 'zooms') (s as EditState['zooms'][number]).auto = false
      }, key)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const dragTrim = (which: 'trimStart' | 'trimEnd') => (e: React.PointerEvent) => {
    e.stopPropagation()
    const key = `trim-${Date.now()}`
    const move = (ev: PointerEvent): void => {
      const t = Math.round(Math.max(0, Math.min(dur, timeFromEvent(ev))))
      edit((d) => {
        if (which === 'trimStart') d.trimStart = Math.min(t, d.trimEnd - 500)
        else d.trimEnd = Math.max(t, d.trimStart + 500)
      }, key)
      setTime(t)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const renderSegments = (def: TrackDef): React.JSX.Element[] =>
    (project.edit[def.track] as Segment[]).map((s) => {
      const sel = selection?.track === def.track && selection.id === s.id
      return (
        <div
          key={s.id}
          className={`seg ${def.className} ${sel ? 'sel' : ''} ${(s as { disabled?: boolean }).disabled ? 'off' : ''}`}
          style={{ left: x(s.start), width: Math.max(4, x(s.end) - x(s.start)) }}
          onPointerDown={dragSegment(def.track, s, 'move')}
          title={def.text(s)}
        >
          <div className="seg-edge l" onPointerDown={dragSegment(def.track, s, 'start')} />
          <span>{def.text(s)}</span>
          <div className="seg-edge r" onPointerDown={dragSegment(def.track, s, 'end')} />
        </div>
      )
    })

  // Ruler ticks at a readable spacing.
  const tickSec = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 70) ?? 600
  const ticks: number[] = []
  for (let s = 0; s <= dur / 1000; s += tickSec) ticks.push(s)

  const outDur = outputDuration(buildPieces(project.edit, dur))
  const tracks = TRACKS.filter((t) => t.track !== 'cameraSegments' || project.files.camera)

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <button className="btn icon" onClick={() => setPlaying(!playing)} title="Play / pause (Space)">
          {playing ? <Icon.pause /> : <Icon.play />}
        </button>
        <div className="tl-time">
          {formatTime(time, true)} <span className="faint">/ {formatTime(dur)}</span>
          <span className="faint" style={{ marginLeft: 10 }}>
            output {formatTime(outDur)}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn sm" onClick={() => addSegment('zooms', { zoom: 1.6, mode: 'follow', target: { x: 0.5, y: 0.5 }, auto: false })} title="Add zoom (Z)">
          <Icon.zoom size={14} /> Zoom
        </button>
        <button className="btn sm" onClick={() => addSegment('cuts', {}, 1500)} title="Cut out a section (C)">
          <Icon.scissors size={14} /> Cut
        </button>
        <button className="btn sm" onClick={() => addSegment('speeds', { speed: 2 }, 3000)} title="Speed up a section">
          <Icon.speed size={14} /> Speed
        </button>
        <button className="btn sm" onClick={() => addSegment('masks', { kind: 'blur', rect: { x: 0.35, y: 0.35, width: 0.3, height: 0.2 } }, 3000)} title="Blur or highlight an area">
          <Icon.blur size={14} /> Mask
        </button>
        {project.files.camera && (
          <button className="btn sm" onClick={() => addSegment('cameraSegments', { layout: 'fullscreen' }, 3000)} title="Change camera layout">
            <Icon.camera size={14} /> Camera
          </button>
        )}
        <div className="sep-v" />
        <Icon.zoom size={14} className="faint" />
        <input
          type="range"
          style={{ width: 110 }}
          min={0}
          max={1}
          step={0.01}
          value={Math.log(pps / fitPx) / Math.log(40)}
          onChange={(e) => {
            const v = Number(e.target.value)
            setPxPerSec(v <= 0.001 ? 0 : fitPx * Math.pow(40, v))
          }}
        />
      </div>
      <div className="tl-scroll scroll" ref={scroller}>
        <div className="tl-inner" style={{ width: totalW + LABEL_W }}>
          <div className="tl-ruler" onPointerDown={scrub}>
            <div className="tl-label" />
            <div className="tl-lane">
              {ticks.map((s) => (
                <div key={s} className="tick" style={{ left: x(s * 1000) }}>
                  {formatTime(s * 1000, tickSec < 1)}
                </div>
              ))}
            </div>
          </div>

          <div className="tl-row">
            <div className="tl-label">Clip</div>
            <div className="tl-lane" onPointerDown={scrub}>
              <div className="clip" style={{ left: 0, width: x(dur) }}>
                <div className="clip-trim" style={{ left: 0, width: x(project.edit.trimStart) }} />
                <div className="clip-trim" style={{ left: x(project.edit.trimEnd), width: Math.max(0, x(dur) - x(project.edit.trimEnd)) }} />
                <div className="trim-handle" style={{ left: x(project.edit.trimStart) - 4 }} onPointerDown={dragTrim('trimStart')} title="Trim start" />
                <div className="trim-handle" style={{ left: x(project.edit.trimEnd) - 4 }} onPointerDown={dragTrim('trimEnd')} title="Trim end" />
                {project.edit.cuts.map((c) => {
                  const sel = selection?.track === 'cuts' && selection.id === c.id
                  return (
                    <div
                      key={c.id}
                      className={`seg seg-cut ${sel ? 'sel' : ''}`}
                      style={{ left: x(c.start), width: Math.max(4, x(c.end) - x(c.start)) }}
                      onPointerDown={dragSegment('cuts', c, 'move')}
                    >
                      <div className="seg-edge l" onPointerDown={dragSegment('cuts', c, 'start')} />
                      <span>Cut</span>
                      <div className="seg-edge r" onPointerDown={dragSegment('cuts', c, 'end')} />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {tracks.map((def) => (
            <div className="tl-row" key={def.track}>
              <div className="tl-label">{def.label}</div>
              <div className="tl-lane" onPointerDown={scrub}>
                {renderSegments(def)}
              </div>
            </div>
          ))}

          <div className="playhead" style={{ left: LABEL_W + x(time) }} />
        </div>
      </div>
    </div>
  )
}
