// Virtual camera: how far, and where, the scene is zoomed at a given source time.
import type { ZoomSegment } from '@shared/types'
import { sampleTrack, springSmooth, type Track } from './cursor'

export interface Viewport {
  /** Zoom factor (1 = no zoom). */
  scale: number
  /** Focus point, normalized to the (cropped) screen. */
  fx: number
  fy: number
  /** 0..1 blend between the un-zoomed frame and the zoom target. */
  amount: number
}

const ZOOM_IN_MS = 650
const ZOOM_OUT_MS = 750

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** How much of a zoom segment is applied at time t (0..1), including its ramps. */
export function zoomAmount(z: ZoomSegment, t: number): number {
  if (t <= z.start || t >= z.end) return 0
  const len = z.end - z.start
  const rin = Math.min(ZOOM_IN_MS, len / 2)
  const rout = Math.min(ZOOM_OUT_MS, len / 2)
  if (t < z.start + rin) return easeInOutCubic((t - z.start) / rin)
  if (t > z.end - rout) return easeInOutCubic((z.end - t) / rout)
  return 1
}

/**
 * Builds a slow, heavily damped "camera operator" track that follows the cursor,
 * so zoomed views pan smoothly instead of jittering with every mouse movement.
 */
export function buildFocusTrack(cursor: Track, size: { width: number; height: number }): Track {
  const n = cursor.xs.length
  const xs = new Float32Array(n)
  const ys = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = Number.isNaN(cursor.xs[i]) ? 0.5 : cursor.xs[i] / size.width
    ys[i] = Number.isNaN(cursor.ys[i]) ? 0.5 : cursor.ys[i] / size.height
  }
  return springSmooth({ step: cursor.step, start: cursor.start, xs, ys }, { stiffness: 14, damping: 7.5 })
}

export function viewportAt(zooms: ZoomSegment[], t: number, focus: Track | null): Viewport {
  let best: ZoomSegment | null = null
  let amount = 0
  for (const z of zooms) {
    const a = zoomAmount(z, t)
    if (a > amount) {
      amount = a
      best = z
    }
  }
  if (!best || amount <= 0) return { scale: 1, fx: 0.5, fy: 0.5, amount: 0 }
  let tx = best.target.x
  let ty = best.target.y
  if (best.mode === 'follow' && focus) {
    const p = sampleTrack(focus, t)
    if (!Number.isNaN(p.x)) {
      tx = p.x
      ty = p.y
    }
  }
  const scale = 1 + (best.zoom - 1) * amount
  return { scale, fx: 0.5 + (tx - 0.5) * amount, fy: 0.5 + (ty - 0.5) * amount, amount }
}
