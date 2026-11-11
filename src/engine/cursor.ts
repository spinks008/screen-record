// Re-renders the recorded cursor: spring smoothing, idle hiding, click effects and cursor shapes.
import type { CursorKind, InputEvent, Style } from '@shared/types'

export const TRACK_HZ = 120

export interface Track {
  /** Sample interval in ms. */
  step: number
  start: number
  xs: Float32Array
  ys: Float32Array
}

export interface SpringParams {
  stiffness: number
  damping: number
}

export const CURSOR_SPRINGS: Record<Exclude<Style['cursor']['smoothing'], 'off'>, SpringParams> = {
  slow: { stiffness: 90, damping: 19 },
  fast: { stiffness: 260, damping: 32 },
  rapid: { stiffness: 650, damping: 51 }
}

interface Point {
  t: number
  x: number
  y: number
}

/** Raw positions from every event that carries coordinates, in time order. */
export function rawPositions(events: InputEvent[]): Point[] {
  const pts: Point[] = []
  for (const e of events) {
    if (e.type === 'key') continue
    pts.push({ t: e.t, x: e.x, y: e.y })
  }
  pts.sort((a, b) => a.t - b.t)
  return pts
}

/** Samples a step-wise linear interpolation of raw positions onto a fixed grid. */
export function resample(points: Point[], durationMs: number, hz = TRACK_HZ): Track {
  const step = 1000 / hz
  const n = Math.max(2, Math.ceil(durationMs / step) + 2)
  const xs = new Float32Array(n)
  const ys = new Float32Array(n)
  let j = 0
  for (let i = 0; i < n; i++) {
    const t = i * step
    if (!points.length) {
      xs[i] = NaN
      ys[i] = NaN
      continue
    }
    while (j < points.length - 1 && points[j + 1].t <= t) j++
    const a = points[j]
    const b = points[Math.min(j + 1, points.length - 1)]
    if (t <= a.t || a === b) {
      xs[i] = a.x
      ys[i] = a.y
    } else {
      // Interpolate only over short gaps; a long gap means the cursor sat still.
      const gap = b.t - a.t
      const f = gap > 250 ? 0 : Math.min(1, (t - a.t) / gap)
      xs[i] = a.x + (b.x - a.x) * f
      ys[i] = a.y + (b.y - a.y) * f
    }
  }
  return { step, start: 0, xs, ys }
}

/** Critically-damped-ish spring following the input track (semi-implicit Euler with substeps). */
export function springSmooth(track: Track, p: SpringParams): Track {
  const n = track.xs.length
  const xs = new Float32Array(n)
  const ys = new Float32Array(n)
  let x = track.xs[0]
  let y = track.ys[0]
  let vx = 0
  let vy = 0
  const sub = 4
  const dt = track.step / 1000 / sub
  for (let i = 0; i < n; i++) {
    const tx = track.xs[i]
    const ty = track.ys[i]
    if (Number.isNaN(x)) {
      x = tx
      y = ty
    }
    for (let s = 0; s < sub; s++) {
      vx += (p.stiffness * (tx - x) - p.damping * vx) * dt
      vy += (p.stiffness * (ty - y) - p.damping * vy) * dt
      x += vx * dt
      y += vy * dt
    }
    xs[i] = x
    ys[i] = y
  }
  return { step: track.step, start: track.start, xs, ys }
}

export function sampleTrack(track: Track, t: number): { x: number; y: number } {
  const f = (t - track.start) / track.step
  const i = Math.max(0, Math.min(track.xs.length - 1, Math.floor(f)))
  const k = Math.max(0, Math.min(track.xs.length - 1, i + 1))
  const a = Math.min(1, Math.max(0, f - i))
  return { x: track.xs[i] + (track.xs[k] - track.xs[i]) * a, y: track.ys[i] + (track.ys[k] - track.ys[i]) * a }
}

export interface CursorModel {
  raw: Track
  smooth: Track
  /** Times at which the cursor meaningfully moved, ascending. */
  moveTimes: number[]
  kinds: { t: number; kind: CursorKind }[]
  kindTimes: number[]
  downs: { t: number; up: number; button: number }[]
  downTimes: number[]
  hasData: boolean
}

export function buildCursorModel(events: InputEvent[], durationMs: number, smoothing: Style['cursor']['smoothing']): CursorModel {
  const pts = rawPositions(events)
  const raw = resample(pts, durationMs)
  const smooth = smoothing === 'off' ? raw : springSmooth(raw, CURSOR_SPRINGS[smoothing])
  const moveTimes: number[] = []
  let last: Point | null = null
  for (const p of pts) {
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 3) {
      moveTimes.push(p.t)
      last = p
    }
  }
  const kinds: { t: number; kind: CursorKind }[] = []
  for (const e of events) if (e.type === 'move' && e.cursor) kinds.push({ t: e.t, kind: e.cursor })
  kinds.sort((a, b) => a.t - b.t)
  const downs: { t: number; up: number; button: number }[] = []
  for (const e of events) {
    if (e.type === 'down') downs.push({ t: e.t, up: Infinity, button: e.button })
    if (e.type === 'up') {
      for (let i = downs.length - 1; i >= 0; i--) {
        if (downs[i].button === e.button && downs[i].up === Infinity) {
          downs[i].up = e.t
          break
        }
      }
    }
  }
  downs.sort((a, b) => a.t - b.t)
  return {
    raw,
    smooth,
    moveTimes,
    kinds,
    kindTimes: kinds.map((k) => k.t),
    downs,
    downTimes: downs.map((d) => d.t),
    hasData: pts.length > 0
  }
}

function lastIndexAtOrBefore(times: number[], t: number): number {
  let lo = 0
  let hi = times.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

export interface CursorFrame {
  x: number
  y: number
  kind: CursorKind
  alpha: number
  /** Press scale (1 = released). */
  scale: number
  /** Ripple progress 0..1 for the latest click, or -1 when none is active. */
  ripple: number
  rippleX: number
  rippleY: number
}

const RIPPLE_MS = 450

export function cursorAt(model: CursorModel, t: number, style: Style['cursor'], outputEnd?: { srcEnd: number; srcStart: number }): CursorFrame {
  let { x, y } = sampleTrack(model.smooth, t)

  // Loop: glide back to the starting position over the last 800 ms.
  if (style.loopToStart && outputEnd) {
    const startPos = sampleTrack(model.smooth, outputEnd.srcStart)
    const glide = 800
    const k = 1 - (outputEnd.srcEnd - t) / glide
    if (k > 0) {
      const e = k * k * (3 - 2 * k)
      x += (startPos.x - x) * e
      y += (startPos.y - y) * e
    }
  }

  let alpha = 1
  if (style.hideIdle && model.moveTimes.length) {
    const idx = lastIndexAtOrBefore(model.moveTimes, t)
    const lastMove = idx >= 0 ? model.moveTimes[idx] : -Infinity
    const idle = t - lastMove - style.idleMs
    if (idle > 0) alpha = Math.max(0, 1 - idle / 250)
    // Fade back in quickly when movement resumes.
    const next = model.moveTimes[idx + 1]
    if (alpha < 1 && next !== undefined && next - t < 120) alpha = Math.max(alpha, 1 - (next - t) / 120)
  }

  const ki = lastIndexAtOrBefore(model.kindTimes, t)
  const kind = ki >= 0 ? model.kinds[ki].kind : 'arrow'

  let scale = 1
  let ripple = -1
  let rippleX = x
  let rippleY = y
  const di = lastIndexAtOrBefore(model.downTimes, t)
  if (di >= 0) {
    const d = model.downs[di]
    if (t < d.up) scale = 0.82
    else if (t - d.up < 120) scale = 0.82 + 0.18 * ((t - d.up) / 120)
    if (style.clickEffect && t - d.t < RIPPLE_MS) {
      ripple = (t - d.t) / RIPPLE_MS
      const p = sampleTrack(model.raw, d.t)
      rippleX = p.x
      rippleY = p.y
    }
  }
  return { x, y, kind, alpha, scale, ripple, rippleX, rippleY }
}
