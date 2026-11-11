import { describe, expect, it } from 'vitest'
import type { InputEvent } from '@shared/types'
import { buildPieces, outToSrc, outputDuration, srcToOut } from '../../src/engine/timeline'
import { generateAutoZooms } from '../../src/engine/autoZoom'
import { buildCursorModel, cursorAt, CURSOR_SPRINGS, resample, springSmooth } from '../../src/engine/cursor'
import { viewportAt, zoomAmount } from '../../src/engine/camera'
import { sceneTransform, screenRect, outputSize } from '../../src/engine/layout'
import { buildKeyPills, pillAt } from '../../src/engine/keys'
import { defaultStyle } from '../../src/engine/defaults'

const edit = (over: Partial<{ trimStart: number; trimEnd: number; cuts: any[]; speeds: any[] }> = {}) => ({
  trimStart: 0,
  trimEnd: 10000,
  cuts: [],
  speeds: [],
  ...over
})

describe('timeline', () => {
  it('maps identity without edits', () => {
    const p = buildPieces(edit(), 10000)
    expect(outputDuration(p)).toBe(10000)
    expect(srcToOut(p, 4000)).toBe(4000)
  })

  it('removes cuts and trims', () => {
    const p = buildPieces(edit({ trimStart: 1000, trimEnd: 9000, cuts: [{ id: 'c', start: 3000, end: 5000 }] }), 10000)
    expect(outputDuration(p)).toBe(6000)
    expect(srcToOut(p, 4000)).toBeNull()
    expect(srcToOut(p, 5000)).toBe(2000)
    expect(outToSrc(p, 2000)).toBe(5000)
  })

  it('applies speed segments and round-trips', () => {
    const p = buildPieces(edit({ speeds: [{ id: 's', start: 2000, end: 6000, speed: 2 }] }), 10000)
    expect(outputDuration(p)).toBe(8000)
    for (const src of [0, 1500, 2500, 5999, 7000, 9999]) {
      const out = srcToOut(p, src)!
      expect(outToSrc(p, out)).toBeCloseTo(src, 5)
    }
  })

  it('handles overlapping cuts and speed crossing a cut', () => {
    const p = buildPieces(
      edit({
        cuts: [
          { id: 'a', start: 2000, end: 4000 },
          { id: 'b', start: 3000, end: 5000 }
        ],
        speeds: [{ id: 's', start: 4500, end: 7000, speed: 4 }]
      }),
      10000
    )
    // kept: 0-2000 (2000), 5000-7000 at 4x (500), 7000-10000 (3000)
    expect(outputDuration(p)).toBe(5500)
  })
})

const size = { width: 1920, height: 1080 }
const click = (t: number, x: number, y: number): InputEvent[] => [
  { type: 'down', t, x, y, button: 1 },
  { type: 'up', t: t + 80, x, y, button: 1 }
]

describe('autoZoom', () => {
  it('creates one zoom per burst of nearby clicks', () => {
    const ev = [...click(2000, 500, 500), ...click(3000, 520, 510), ...click(12000, 1500, 800)]
    const z = generateAutoZooms(ev, 20000, size)
    expect(z).toHaveLength(2)
    expect(z[0].start).toBeLessThan(2000)
    expect(z[0].end).toBeGreaterThan(3000)
    expect(z[1].target.x).toBeCloseTo(1500 / 1920, 3)
  })

  it('merges close bursts and ignores right clicks and early clicks', () => {
    const ev: InputEvent[] = [
      ...click(100, 10, 10),
      { type: 'down', t: 5000, x: 300, y: 300, button: 2 },
      ...click(2000, 500, 500),
      ...click(4500, 520, 500)
    ]
    const z = generateAutoZooms(ev, 20000, size)
    expect(z).toHaveLength(1)
    expect(z[0].start).toBeGreaterThan(1000)
  })

  it('skips bursts spread across the screen', () => {
    const ev = [...click(2000, 50, 50), ...click(2500, 1850, 1000)]
    expect(generateAutoZooms(ev, 20000, size)).toHaveLength(0)
  })
})

describe('cursor', () => {
  it('spring smoothing converges to the target at every speed', () => {
    const raw = resample(
      [
        { t: 0, x: 0, y: 0 },
        { t: 100, x: 1000, y: 500 }
      ],
      3000
    )
    for (const p of Object.values(CURSOR_SPRINGS)) {
      const s = springSmooth(raw, p)
      const last = s.xs.length - 1
      expect(s.xs[last]).toBeCloseTo(1000, 0)
      expect(s.ys[last]).toBeCloseTo(500, 0)
      // No wild overshoot.
      expect(Math.max(...s.xs)).toBeLessThan(1060)
    }
  })

  it('hides an idle cursor and shows it again on movement', () => {
    const ev: InputEvent[] = [
      { type: 'move', t: 0, x: 10, y: 10 },
      { type: 'move', t: 100, x: 200, y: 200 },
      { type: 'move', t: 8000, x: 400, y: 400 }
    ]
    const style = { ...defaultStyle().cursor, idleMs: 2000 }
    const m = buildCursorModel(ev, 10000, style.smoothing)
    expect(cursorAt(m, 500, style).alpha).toBe(1)
    expect(cursorAt(m, 5000, style).alpha).toBe(0)
    expect(cursorAt(m, 8050, style).alpha).toBe(1)
  })
})

describe('camera & layout', () => {
  const z = { id: 'z', start: 1000, end: 5000, zoom: 2, mode: 'fixed' as const, target: { x: 0.9, y: 0.9 }, auto: false }

  it('ramps zoom in and out', () => {
    expect(zoomAmount(z, 900)).toBe(0)
    expect(zoomAmount(z, 3000)).toBe(1)
    expect(zoomAmount(z, 1100)).toBeGreaterThan(0)
    expect(zoomAmount(z, 1100)).toBeLessThan(1)
  })

  it('keeps the zoomed view inside the screen', () => {
    const style = defaultStyle()
    const out = outputSize(style, size, 1080)
    const screen = screenRect(style, size, out)
    const vp = viewportAt([z], 3000, null)
    const tr = sceneTransform(vp, screen, out)
    // Visible content region in scene coordinates.
    const left = -tr.tx / tr.scale
    const right = (out.width - tr.tx) / tr.scale
    expect(left).toBeGreaterThanOrEqual(screen.x - 0.01)
    expect(right).toBeLessThanOrEqual(screen.x + screen.width + 0.01)
  })

  it('is the identity when not zoomed', () => {
    const style = defaultStyle()
    const out = outputSize(style, size, 1080)
    const tr = sceneTransform(viewportAt([], 0, null), screenRect(style, size, out), out)
    expect(tr.scale).toBe(1)
    expect(tr.tx).toBeCloseTo(0, 5)
    expect(tr.ty).toBeCloseTo(0, 5)
  })
})

describe('keys', () => {
  it('shows combos and counts repeats', () => {
    const k = (t: number, key: string, ctrl = true): InputEvent => ({ type: 'key', t, key, ctrl, shift: false, alt: false, meta: false })
    const pills = buildKeyPills([k(1000, 'C'), k(1300, 'C'), k(5000, 'a', false)], 'combos')
    expect(pills).toHaveLength(1)
    expect(pills[0].label).toBe('Ctrl + C ×2')
    expect(pillAt(pills, 1500)?.label).toBe('Ctrl + C ×2')
    expect(pillAt(pills, 4000)).toBeNull()
  })
})
