// Virtual camera: how far, and where, the scene is zoomed at a given source time.
import type { Rect, SpringConfig, ZoomSegment } from '@shared/types'
import { sampleTrack, smoothTrack, TRACK_HZ, type Track } from './cursor'
import { SCREEN_PRESETS, settleTime, stepSpring, type SpringState } from './spring'

export interface Viewport {
  /** Zoom factor (1 = no zoom). */
  scale: number
  /** Point at the center of the view, normalized to the (cropped) screen. */
  fx: number
  fy: number
}

/** Output size divided by the screen rect size, per axis (> 1 when there is padding). */
export interface ViewRatio {
  x: number
  y: number
}

/** Precomputed camera path: the view center (normalized to the screen) and 1/scale, per sample. */
export interface CameraTrack {
  step: number
  fx: Float32Array
  fy: Float32Array
  inv: Float32Array
}

/** Half the view size, normalized to the screen, for a given 1/scale. */
function halfView(ratio: number, inv: number): number {
  return (ratio * inv) / 2
}

/** Width of the soft start of panning, in screen units. */
const HINGE = 0.08

/**
 * How far the view center may sit from the screen center, given the room `x` = 0.5 - half view.
 * Zero while the whole screen is visible, then growing smoothly (never more than `x`), so panning
 * fades in as the zoom passes "fit" instead of starting with a jerk.
 */
function reach(x: number): number {
  if (x <= 0) return 0
  return x < HINGE ? (x * x) / (2 * HINGE) : x - HINGE / 2
}

/**
 * Focus point -> position `u` (0.5 = centered), relative to the reach at that zoom. The view center
 * is `0.5 + (u - 0.5) * 2 * reach`: at a fixed `u`, zooming moves the view straight towards
 * (or away from) its target, without sliding sideways.
 */
function toEdge(f: number, half: number): number {
  const m = reach(0.5 - half)
  return m < 1e-6 ? 0.5 : 0.5 + (f - 0.5) / (2 * m)
}

/** Zooms closer together than this pan straight from one to the next without zooming out. */
const BRIDGE_MS = 1500
/** While holding still, the camera ignores the cursor inside this central fraction of the zoomed view. */
const HOLD_ZONE = 0.35
/** Once it moves, the camera follows until the cursor is within this fraction of the center. */
const TRACK_ZONE = 0.1
/** The camera looks this far ahead on the cursor's path, so it leaves when the cursor leaves. */
const LOOKAHEAD_MS = 200
/** Window of the zero-lag smoothing applied to the cursor before the camera follows it. */
const ATTENTION_MS = 400
/** The camera goes back to holding still once the cursor has been slow for this long. */
const SETTLE_MS = 250
/** "Slow", in screen widths per second. */
const SLOW_SPEED = 0.04
/**
 * The goal is eased in over this time constant before the spring sees it, so a move starts
 * with a short ramp instead of an instant jolt of acceleration.
 */
const GOAL_EASE_SEC = 0.04
/** Most zoom a spring blend may reach. */
const MAX_LOG_ZOOM = Math.log(8)

interface Active {
  z: ZoomSegment
  from: number
  to: number
}

/** When each segment drives the camera: its ramp-out lead removed, short gaps to the next one bridged. */
function activeIntervals(zooms: ZoomSegment[], outLeadMs: number): Active[] {
  const sorted = [...zooms].filter((z) => z.end > z.start && !z.disabled).sort((a, b) => a.start - b.start)
  return sorted.map((z, i) => {
    const next = sorted[i + 1]
    let to = z.end - Math.min(outLeadMs, (z.end - z.start) / 2)
    if (next && next.start - z.end < BRIDGE_MS) to = Math.max(to, next.start)
    return { z, from: z.start, to }
  })
}

/**
 * Keeps a focus coordinate where a view of half-size `half` stays on the screen. With `snap` > 0
 * the view may extend into the padding (up to `snap` of it), and a focus near an edge snaps onto that limit.
 */
function clampFocus(f: number, half: number, pad = 0, snap = 0): number {
  if (half >= 0.5 + pad * snap) return 0.5
  const lo = half - pad * snap
  const hi = 1 - half + pad * snap
  if (snap > 0) {
    const zone = snap * half
    if (f - lo < zone) return lo
    if (hi - f < zone) return hi
  }
  return Math.min(hi, Math.max(lo, f))
}

/** How long before a segment ends the camera starts zooming out, so it is out by the end. */
export function outLeadMs(spring: SpringConfig): number {
  return Math.min(900, Math.max(250, settleTime(spring, 0.9, GOAL_EASE_SEC) * 1000))
}

/**
 * Builds the camera path.
 *
 * Zoom is a spring on log(scale), so it changes at an even rate. Position is a spring on `u`
 * (see `toEdge`); while the whole screen is visible `u` has no effect, so it jumps straight to the
 * next target and a zoom-in is a pure push towards it. When following the cursor, the camera
 * tracks a zero-lag smoothed copy of its path, slightly ahead of time: it holds still while the
 * cursor stays near the middle, and once the cursor leaves it re-centers on it, then holds again.
 */
export function buildCameraTrack(
  zooms: ZoomSegment[],
  durationMs: number,
  cursor: Track | null,
  src: { width: number; height: number },
  crop: Rect,
  ratio: ViewRatio,
  spring: SpringConfig = SCREEN_PRESETS.quick
): CameraTrack {
  const step = 1000 / TRACK_HZ
  const n = Math.max(2, Math.ceil(durationMs / step) + 2)
  const fx = new Float32Array(n)
  const fy = new Float32Array(n)
  const inv = new Float32Array(n)
  const intervals = activeIntervals(zooms, outLeadMs(spring))
  // Padding on each side, in screen units (ratio = output / screen).
  const padX = Math.max(0, (ratio.x - 1) / 2)
  const padY = Math.max(0, (ratio.y - 1) / 2)

  const attention = cursor ? smoothTrack(cursor, ATTENTION_MS) : null
  const attentionAt = (t: number): { x: number; y: number } | null => {
    if (!attention) return null
    const p = sampleTrack(attention, t)
    if (Number.isNaN(p.x) || Number.isNaN(p.y)) return null
    return { x: (p.x / src.width - crop.x) / crop.width, y: (p.y / src.height - crop.y) / crop.height }
  }

  // Spring state (position `u` per axis, log zoom), plus the eased goal each spring chases.
  const sx: SpringState = { x: 0.5, v: 0 }
  const sy: SpringState = { x: 0.5, v: 0 }
  const sz: SpringState = { x: 0, v: 0 }
  let ex = 0.5
  let ey = 0.5
  let ez = 0
  const dt = step / 1000
  const ease = 1 - Math.exp(-dt / GOAL_EASE_SEC)
  /** Steps a spring; past [lo, hi] it may only move back in, so a bouncy spring stops at the limit. */
  const advance = (s: SpringState, goal: number, lo: number, hi: number): void => {
    const before = s.x
    stepSpring(s, goal, spring, dt)
    if (s.x < lo && s.x < before) {
      s.x = Math.max(s.x, Math.min(before, lo))
      s.v = 0
    } else if (s.x > hi && s.x > before) {
      s.x = Math.min(s.x, Math.max(before, hi))
      s.v = 0
    }
  }

  let current: ZoomSegment | null = null
  let focusX = 0.5
  let focusY = 0.5
  let tracking = false
  let slowMs = 0
  // Goals and limits persist after a segment ends: zooming out pulls straight back from where the view was.
  let gx = 0.5
  let gy = 0.5
  let loX = 0
  let hiX = 1
  let loY = 0
  let hiY = 1
  let overX = 0
  let overY = 0
  for (let i = 0; i < n; i++) {
    const t = i * step
    // The latest-starting segment that is active wins.
    let active: ZoomSegment | null = null
    for (const a of intervals) {
      if (a.from > t) break
      if (t < a.to) active = a.z
    }

    let gz = 0
    if (active) {
      gz = Math.log(active.zoom)
      const hx = halfView(ratio.x, 1 / active.zoom)
      const hy = halfView(ratio.y, 1 / active.zoom)
      if (active !== current) {
        const c = active.mode === 'follow' && !active.auto ? attentionAt(active.start) : null
        focusX = c ? c.x : active.target.x
        focusY = c ? c.y : active.target.y
        tracking = false
        slowMs = 0
      }
      if (active.mode === 'follow') {
        const c = attentionAt(t + LOOKAHEAD_MS)
        const p = attentionAt(t + LOOKAHEAD_MS - step)
        if (c && p) {
          if (!tracking && (Math.abs(c.x - focusX) > hx * HOLD_ZONE || Math.abs(c.y - focusY) > hy * HOLD_ZONE)) {
            tracking = true
            slowMs = 0
          }
          if (tracking) {
            const zx = hx * TRACK_ZONE
            const zy = hy * TRACK_ZONE
            if (c.x > focusX + zx) focusX = c.x - zx
            else if (c.x < focusX - zx) focusX = c.x + zx
            if (c.y > focusY + zy) focusY = c.y - zy
            else if (c.y < focusY - zy) focusY = c.y + zy
            slowMs = Math.hypot(c.x - p.x, c.y - p.y) / dt < SLOW_SPEED ? slowMs + step : 0
            if (slowMs >= SETTLE_MS) tracking = false
          }
        }
      } else {
        focusX = active.target.x
        focusY = active.target.y
      }
      const snap = Math.min(1, Math.max(0, active.snapEdges ?? 0))
      // The tracked focus stays inside the screen so the zones keep working; only the goal snaps.
      focusX = clampFocus(focusX, hx)
      focusY = clampFocus(focusY, hy)
      gx = toEdge(clampFocus(focusX, hx, padX, snap), hx)
      gy = toEdge(clampFocus(focusY, hy, padY, snap), hy)
      loX = Math.min(toEdge(hx, hx), gx)
      hiX = Math.max(toEdge(1 - hx, hx), gx)
      loY = Math.min(toEdge(hy, hy), gy)
      hiY = Math.max(toEdge(1 - hy, hy), gy)
      overX = padX * snap
      overY = padY * snap
    }
    current = active

    if (i === 0) {
      sx.x = ex = gx
      sy.x = ey = gy
      sz.x = ez = gz
    } else {
      ez += (gz - ez) * ease
      advance(sz, ez, 0, MAX_LOG_ZOOM)
    }
    const w = Math.exp(-sz.x)
    // Room for the view center on each side of the screen center at the current zoom.
    const roomX = 0.5 - halfView(ratio.x, w)
    const roomY = 0.5 - halfView(ratio.y, w)
    const mx = reach(roomX)
    const my = reach(roomY)
    if (i > 0) {
      if (mx < 1e-6) {
        // The whole width is visible: position has no effect, so take the goal directly.
        sx.x = ex = gx
        sx.v = 0
      } else {
        ex += (gx - ex) * ease
        advance(sx, ex, loX, hiX)
      }
      if (my < 1e-6) {
        sy.x = ey = gy
        sy.v = 0
      } else {
        ey += (gy - ey) * ease
        advance(sy, ey, loY, hiY)
      }
    }
    // Never show past the screen (beyond what a snapped edge allows), whatever the springs do.
    const limX = Math.max(0, roomX) + (mx > 0 ? overX : 0)
    const limY = Math.max(0, roomY) + (my > 0 ? overY : 0)
    fx[i] = 0.5 + Math.min(limX, Math.max(-limX, (sx.x - 0.5) * 2 * mx))
    fy[i] = 0.5 + Math.min(limY, Math.max(-limY, (sy.x - 0.5) * 2 * my))
    inv[i] = w
  }
  return { step, fx, fy, inv }
}

export function viewportAt(track: CameraTrack | null, t: number): Viewport {
  if (!track) return { scale: 1, fx: 0.5, fy: 0.5 }
  const f = t / track.step
  const i = Math.max(0, Math.min(track.inv.length - 1, Math.floor(f)))
  const k = Math.min(track.inv.length - 1, i + 1)
  const a = Math.min(1, Math.max(0, f - i))
  const lerp = (arr: Float32Array): number => arr[i] + (arr[k] - arr[i]) * a
  return { scale: 1 / lerp(track.inv), fx: lerp(track.fx), fy: lerp(track.fy) }
}
