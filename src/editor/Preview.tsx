import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Project, Rect } from '@shared/types'
import { Compositor } from '../engine/compositor'
import { outputAspect, screenRect, sourceToScreen } from '../engine/layout'
import { buildPieces, pieceAtOrAfter } from '../engine/timeline'
import { mediaUrl } from '../lib/api'
import { useEditor } from './store'

function syncMedia(el: HTMLMediaElement | null, seconds: number, rate: number, playing: boolean, tolerance = 0.15): void {
  if (!el || el.readyState < 1) return
  const dur = Number.isFinite(el.duration) ? el.duration : Infinity
  const inRange = seconds >= 0 && seconds < dur
  if (!inRange) {
    if (!el.paused) el.pause()
    return
  }
  if (Math.abs(el.currentTime - seconds) > tolerance) el.currentTime = seconds
  if (el.playbackRate !== rate) el.playbackRate = rate
  if (playing && el.paused) void el.play().catch(() => undefined)
  if (!playing && !el.paused) el.pause()
}

export function Preview(): React.JSX.Element {
  const project = useEditor((s) => s.project)!
  const events = useEditor((s) => s.events)
  const playing = useEditor((s) => s.playing)
  const time = useEditor((s) => s.time)
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const comp = useRef<Compositor | null>(null)
  const screenV = useRef<HTMLVideoElement>(null)
  const cameraV = useRef<HTMLVideoElement>(null)
  const micA = useRef<HTMLAudioElement>(null)
  const sysA = useRef<HTMLAudioElement>(null)
  const [cssSize, setCssSize] = useState({ width: 0, height: 0 })
  const projectRef = useRef(project)
  projectRef.current = project

  const aspect = outputAspect(project.edit.style, project.capture)

  // Fit the canvas to the available space at the output aspect ratio.
  useLayoutEffect(() => {
    const el = box.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const pad = 24
      const w = Math.max(10, r.width - pad * 2)
      const h = Math.max(10, r.height - pad * 2)
      const width = Math.min(w, h * aspect)
      setCssSize({ width, height: width / aspect })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [aspect])

  useEffect(() => {
    if (!canvas.current) return
    const c = new Compositor(canvas.current, 16, 16)
    comp.current = c
    c.onAssetLoaded = () => renderNow()
    return () => {
      c.destroy()
      comp.current = null
    }
  }, [])

  const renderNow = (): void => {
    const c = comp.current
    const v = screenV.current
    if (!c || !v) return
    c.render(v.readyState >= 2 && !useEditor.getState().playing ? useEditor.getState().time : v.currentTime * 1000)
  }

  useEffect(() => {
    const c = comp.current
    if (!c || !cssSize.width) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.resize(Math.round(cssSize.width * dpr), Math.round(cssSize.height * dpr))
    renderNow()
  }, [cssSize])

  useEffect(() => {
    comp.current?.setProject(project, events)
    renderNow()
  }, [project, events])

  // Wire media sources once their metadata is available.
  useEffect(() => {
    const onReady = (): void => {
      comp.current?.setSources(screenV.current, project.files.camera ? cameraV.current : null)
      renderNow()
    }
    const v = screenV.current!
    v.addEventListener('loadeddata', onReady)
    cameraV.current?.addEventListener('loadeddata', onReady)
    return () => {
      v.removeEventListener('loadeddata', onReady)
      cameraV.current?.removeEventListener('loadeddata', onReady)
    }
  }, [project.id])

  // Audio levels follow the style.
  useEffect(() => {
    const a = project.edit.style.audio
    if (micA.current) {
      micA.current.volume = Math.min(1, a.mic.volume)
      micA.current.muted = a.mic.muted
    }
    if (sysA.current) {
      sysA.current.volume = Math.min(1, a.system.volume)
      sysA.current.muted = a.system.muted
    }
  }, [project.edit.style.audio])

  // Paused: seek to the playhead and render once the frame is there.
  useEffect(() => {
    if (playing) return
    const v = screenV.current
    if (!v || v.readyState < 1) return
    const p = projectRef.current
    v.pause()
    for (const el of [cameraV.current, micA.current, sysA.current]) el?.pause()
    const target = time / 1000
    if (Math.abs(v.currentTime - target) < 0.001) {
      renderNow()
      return
    }
    const onSeeked = (): void => {
      if (cameraV.current && p.files.camera) {
        const ct = (time - p.offsets.camera) / 1000
        if (ct >= 0) cameraV.current.currentTime = ct
      }
      // Wait until the decoded frame is actually presented.
      if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(() => renderNow())
      setTimeout(renderNow, 60)
    }
    v.addEventListener('seeked', onSeeked, { once: true })
    v.currentTime = target
    return () => v.removeEventListener('seeked', onSeeked)
  }, [time, playing])

  // Playing: drive time from the screen video, skipping cuts and applying speed.
  useEffect(() => {
    if (!playing) return
    const v = screenV.current!
    let raf = 0
    let stopped = false
    const p0 = projectRef.current
    const pieces0 = buildPieces(p0.edit, p0.durationMs)
    const startPiece = pieceAtOrAfter(pieces0, useEditor.getState().time)
    if (!startPiece) {
      // At the end: restart from the beginning.
      const first = pieces0[0]
      v.currentTime = (first?.srcStart ?? 0) / 1000
    } else if (useEditor.getState().time < startPiece.srcStart) v.currentTime = startPiece.srcStart / 1000
    else v.currentTime = useEditor.getState().time / 1000
    void v.play().catch(() => undefined)

    const tick = (): void => {
      if (stopped) return
      const p = projectRef.current
      const pieces = buildPieces(p.edit, p.durationMs)
      const t = v.currentTime * 1000
      const piece = pieceAtOrAfter(pieces, t)
      if (!piece || v.ended) {
        v.pause()
        useEditor.getState().setPlaying(false)
        useEditor.getState().setTime(pieces.length ? pieces[pieces.length - 1].srcEnd - 1 : t)
        return
      }
      if (t < piece.srcStart - 20) {
        v.currentTime = piece.srcStart / 1000
      }
      if (v.playbackRate !== piece.speed) v.playbackRate = piece.speed
      const rate = piece.speed
      syncMedia(cameraV.current, (t - p.offsets.camera) / 1000, rate, true, 0.12)
      syncMedia(micA.current, (t - p.offsets.mic) / 1000, rate, true)
      syncMedia(sysA.current, (t - p.offsets.system) / 1000, rate, true)
      comp.current?.render(t)
      useEditor.setState({ time: t })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      v.pause()
      for (const el of [cameraV.current, micA.current, sysA.current]) el?.pause()
    }
  }, [playing])

  return (
    <div className="preview" ref={box}>
      <div className="preview-stage" style={{ width: cssSize.width, height: cssSize.height }}>
        <canvas ref={canvas} style={{ width: '100%', height: '100%', display: 'block', borderRadius: 6 }} />
        <SelectionOverlay cssSize={cssSize} compositor={comp} />
      </div>
      <div style={{ display: 'none' }}>
        <video ref={screenV} src={mediaUrl(project.id, project.files.screen)} preload="auto" muted playsInline crossOrigin="anonymous" />
        {project.files.camera && (
          <video ref={cameraV} src={mediaUrl(project.id, project.files.camera)} preload="auto" muted playsInline crossOrigin="anonymous" />
        )}
        {project.files.mic && <audio ref={micA} src={mediaUrl(project.id, project.files.mic)} preload="auto" />}
        {project.files.system && <audio ref={sysA} src={mediaUrl(project.id, project.files.system)} preload="auto" />}
      </div>
    </div>
  )
}

/** Draggable rectangle (blur/highlight masks) or target point (fixed zooms) over the preview. */
function SelectionOverlay({ cssSize, compositor }: { cssSize: { width: number; height: number }; compositor: React.RefObject<Compositor | null> }): React.JSX.Element | null {
  const project = useEditor((s) => s.project)!
  const selection = useEditor((s) => s.selection)
  const edit = useEditor((s) => s.edit)
  useEditor((s) => s.time)
  const drag = useRef<{ mode: string; x: number; y: number; rect: Rect } | null>(null)

  if (!selection || !cssSize.width) return null
  const style = project.edit.style
  const src = project.capture
  // Overlay coordinates are computed without zoom (masks are edited on the un-zoomed frame).
  const screen = screenRect(style, src, cssSize)
  const tr = compositor.current?.transform
  const dprScale = compositor.current ? cssSize.width / compositor.current.size.width : 1
  const toCss = (nx: number, ny: number): { x: number; y: number } => {
    const p = sourceToScreen(style, src, screen, nx * src.width, ny * src.height)
    if (!tr) return p
    return { x: p.x * tr.scale + tr.tx * dprScale, y: p.y * tr.scale + tr.ty * dprScale }
  }
  const scale = tr?.scale ?? 1
  const pxToNorm = (dx: number, dy: number): { dx: number; dy: number } => ({
    dx: (dx / scale / screen.width) * style.crop.width,
    dy: (dy / scale / screen.height) * style.crop.height
  })

  const onDown = (mode: string, rect: Rect) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, y: e.clientY, rect }
  }
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

  if (selection.track === 'masks') {
    const mask = project.edit.masks.find((m) => m.id === selection.id)
    if (!mask) return null
    const a = toCss(mask.rect.x, mask.rect.y)
    const b = toCss(mask.rect.x + mask.rect.width, mask.rect.y + mask.rect.height)
    const onMove = (e: React.PointerEvent): void => {
      const d = drag.current
      if (!d) return
      const { dx, dy } = pxToNorm(e.clientX - d.x, e.clientY - d.y)
      const r = { ...d.rect }
      if (d.mode === 'move') {
        r.x = clamp01(Math.min(1 - r.width, r.x + dx))
        r.y = clamp01(Math.min(1 - r.height, r.y + dy))
      } else {
        r.width = Math.max(0.02, Math.min(1 - r.x, r.width + dx))
        r.height = Math.max(0.02, Math.min(1 - r.y, r.height + dy))
      }
      edit((draft) => {
        const m = draft.masks.find((x) => x.id === mask.id)
        if (m) m.rect = r
      }, `mask-rect-${mask.id}`)
    }
    return (
      <div className="overlay" onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
        <div className="mask-box" style={{ left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y }} onPointerDown={onDown('move', mask.rect)}>
          <div className="mask-handle" onPointerDown={onDown('resize', mask.rect)} />
        </div>
      </div>
    )
  }

  if (selection.track === 'zooms') {
    const z = project.edit.zooms.find((x) => x.id === selection.id)
    if (!z || z.mode !== 'fixed') return null
    const p = toCss(z.target.x, z.target.y)
    const onMove = (e: React.PointerEvent): void => {
      const d = drag.current
      if (!d) return
      const { dx, dy } = pxToNorm(e.clientX - d.x, e.clientY - d.y)
      edit((draft) => {
        const zz = draft.zooms.find((x) => x.id === z.id)
        if (zz) zz.target = { x: clamp01(d.rect.x + dx), y: clamp01(d.rect.y + dy) }
      }, `zoom-target-${z.id}`)
    }
    return (
      <div className="overlay" onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
        <div className="zoom-target" style={{ left: p.x, top: p.y }} onPointerDown={onDown('move', { x: z.target.x, y: z.target.y, width: 0, height: 0 })} />
      </div>
    )
  }
  return null
}
