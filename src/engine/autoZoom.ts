// Generates zoom segments from where and when the user clicked.
import type { InputEvent, ZoomSegment } from '@shared/types'

export interface AutoZoomOptions {
  zoom: number
  /** Start zooming this long before the first click of a burst. */
  leadMs: number
  /** Stay zoomed this long after the last click of a burst. */
  holdMs: number
  /** Clicks closer together than this belong to one burst. */
  burstGapMs: number
  minDurationMs: number
  /** Bursts whose clicks span more than this fraction of the frame are not zoomed. */
  maxSpread: number
  /** Zooms separated by less than this are merged into one. */
  mergeGapMs: number
  /** Ignore clicks this close to the start (e.g. focusing the window). */
  ignoreStartMs: number
}

export const DEFAULT_AUTO_ZOOM: AutoZoomOptions = {
  zoom: 1.7,
  leadMs: 450,
  holdMs: 1600,
  burstGapMs: 2200,
  minDurationMs: 1800,
  maxSpread: 0.6,
  mergeGapMs: 800,
  ignoreStartMs: 400
}

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

interface Click {
  t: number
  x: number
  y: number
}

export function generateAutoZooms(
  events: InputEvent[],
  durationMs: number,
  size: { width: number; height: number },
  options: Partial<AutoZoomOptions> = {}
): ZoomSegment[] {
  const o = { ...DEFAULT_AUTO_ZOOM, ...options }
  const clicks: Click[] = []
  let lastDown: Click | null = null
  for (const e of events) {
    if ((e.type === 'down' || e.type === 'up') && e.button !== 1) continue
    if (e.type === 'down') {
      if (e.t < o.ignoreStartMs || e.t > durationMs) continue
      if (e.x < 0 || e.y < 0 || e.x > size.width || e.y > size.height) continue
      lastDown = { t: e.t, x: e.x, y: e.y }
      clicks.push(lastDown)
    } else if (e.type === 'up' && lastDown) {
      // A drag counts as activity until the button is released.
      if (Math.hypot(e.x - lastDown.x, e.y - lastDown.y) > 20 && e.t - lastDown.t > 120) {
        clicks.push({ t: e.t, x: e.x, y: e.y })
      }
      lastDown = null
    }
  }
  clicks.sort((a, b) => a.t - b.t)

  const bursts: Click[][] = []
  for (const c of clicks) {
    const cur = bursts[bursts.length - 1]
    if (cur && c.t - cur[cur.length - 1].t <= o.burstGapMs) cur.push(c)
    else bursts.push([c])
  }

  const zooms: ZoomSegment[] = []
  for (const burst of bursts) {
    const xs = burst.map((c) => c.x / size.width)
    const ys = burst.map((c) => c.y / size.height)
    const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    if (spread > o.maxSpread) continue
    let start = Math.max(0, burst[0].t - o.leadMs)
    let end = Math.min(durationMs, burst[burst.length - 1].t + o.holdMs)
    if (end - start < o.minDurationMs) end = Math.min(durationMs, start + o.minDurationMs)
    if (end - start < o.minDurationMs) start = Math.max(0, end - o.minDurationMs)
    const avg = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length
    zooms.push({
      id: newId('zoom'),
      start,
      end,
      zoom: o.zoom,
      mode: 'follow',
      target: { x: avg(xs), y: avg(ys) },
      auto: true
    })
  }

  const merged: ZoomSegment[] = []
  for (const z of zooms) {
    const last = merged[merged.length - 1]
    if (last && z.start - last.end <= o.mergeGapMs) {
      last.end = Math.max(last.end, z.end)
    } else merged.push(z)
  }
  // A single zoom over the whole recording adds nothing.
  return merged.filter((z) => !(z.start <= 0 && z.end >= durationMs))
}
