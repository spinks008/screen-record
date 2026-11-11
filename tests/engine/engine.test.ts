import { describe, expect, it } from 'vitest'
import type { InputEvent, ZoomSegment } from '@shared/types'
import { buildPieces, outToSrc, outputDuration, srcToOut } from '../../src/engine/timeline'
import { generateAutoZooms } from '../../src/engine/autoZoom'
import { buildCursorModel, cursorAt, holdCursorKinds, resample, springSmooth, type Track } from '../../src/engine/cursor'
import { buildCameraTrack, outLeadMs, viewportAt } from '../../src/engine/camera'
import { cameraRect, cardRect, sceneTransform, screenRect, outputSize } from '../../src/engine/layout'
import { buildKeyPills, pillAt } from '../../src/engine/keys'
import { defaultStyle, normalizeStyle } from '../../src/engine/defaults'
import { CURSOR_PRESETS, SCREEN_PRESETS, cursorSpring, screenSpring, settleTime } from '../../src/engine/spring'
import { clickOutputTimes, encodeWav, synthClick } from '../../src/engine/clickSound'

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
    // A burst zooms into its first click, not the average of its clicks.
    expect(z[0].target.x).toBeCloseTo(500 / 1920, 3)
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
    for (const p of Object.values(CURSOR_PRESETS)) {
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
    const m = buildCursorModel(ev, 10000, { spring: cursorSpring(defaultStyle().motion.cursor) })
    expect(cursorAt(m, 500, style).alpha).toBe(1)
    expect(cursorAt(m, 5000, style).alpha).toBe(0)
    expect(cursorAt(m, 8050, style).alpha).toBe(1)
  })

  it('ignores cursor shapes that flash for less than the hold time', () => {
    const kinds = [
      { t: 0, kind: 'arrow' as const },
      { t: 1000, kind: 'ibeam' as const },
      { t: 1050, kind: 'arrow' as const },
      { t: 3000, kind: 'hand' as const },
      { t: 4000, kind: 'arrow' as const }
    ]
    expect(holdCursorKinds(kinds, 120).map((k) => k.kind)).toEqual(['arrow', 'hand', 'arrow'])
    expect(holdCursorKinds(kinds, 0)).toHaveLength(5)
  })

  it('always draws the arrow when asked to', () => {
    const ev: InputEvent[] = [
      { type: 'move', t: 0, x: 10, y: 10, cursor: 'arrow' },
      { type: 'move', t: 500, x: 20, y: 10, cursor: 'ibeam' }
    ]
    const m = buildCursorModel(ev, 2000, { spring: null, typeHoldMs: 0 })
    const style = defaultStyle().cursor
    expect(cursorAt(m, 1000, style).kind).toBe('ibeam')
    expect(cursorAt(m, 1000, { ...style, alwaysArrow: true }).kind).toBe('arrow')
    expect(cursorAt(m, 600, { ...style, clickEffect: 'none' }).ripple).toBe(-1)
  })
})

describe('springs', () => {
  it('camera presets are critically damped: they never overshoot', () => {
    for (const s of Object.values(SCREEN_PRESETS)) expect(s.friction).toBeCloseTo(2 * Math.sqrt(s.tension * s.mass), 5)
  })

  it('the default camera settles in ~0.4 s, like the reference', () => {
    const t = settleTime(screenSpring(defaultStyle().motion.screen), 0.9, 0.04)
    expect(t).toBeGreaterThan(0.3)
    expect(t).toBeLessThan(0.45)
    // Slower presets take longer.
    expect(settleTime(SCREEN_PRESETS.slow)).toBeGreaterThan(settleTime(SCREEN_PRESETS.rapid))
    expect(outLeadMs(SCREEN_PRESETS.quick)).toBeGreaterThan(250)
    expect(outLeadMs(SCREEN_PRESETS.quick)).toBeLessThan(450)
  })
})

describe('style migration', () => {
  it('upgrades a v1 style and keeps its look', () => {
    const v1 = {
      background: { kind: 'gradient', value: 'ocean', blur: 0 },
      padding: 0.1,
      radius: 20,
      shadow: 0.3,
      aspect: '16:9',
      crop: { x: 0.1, y: 0, width: 0.8, height: 1 },
      motionBlur: 0.7,
      cursor: { visible: true, size: 2, smoothing: 'fast', hideIdle: false, idleMs: 3000, clickEffect: false, loopToStart: true },
      camera: { visible: false, shape: 'rounded', size: 0.3, corner: 'top-left', mirror: false },
      keys: { enabled: false, mode: 'all' },
      audio: { mic: { volume: 0.5, muted: true }, system: { volume: 1, muted: false } }
    }
    const s = normalizeStyle(v1)
    expect(s.background).toEqual({ kind: 'gradient', value: 'ocean', blur: 0 })
    expect(s.shadow).toEqual({ strength: 0.3, blur: 40, offsetY: 14 })
    expect(s.motionBlur).toEqual({ enabled: true, zoom: 0.7, pan: 0.7, cursor: 0, camera: 0 })
    expect(s.motion.cursor.preset).toBe('quick')
    expect(cursorSpring(s.motion.cursor)).toEqual({ tension: 260, friction: 32, mass: 1 })
    expect(s.cursor.clickEffect).toBe('none')
    expect(s.cursor.size).toBe(2)
    expect(s.cursor.loopToStart).toBe(true)
    expect(s.camera).toMatchObject({ shape: 'rounded', size: 0.3, corner: 'top-left', aspect: 1 })
    expect(s.crop).toEqual(v1.crop)
    expect(s.inset.enabled).toBe(false)
    expect((s.cursor as Record<string, unknown>).smoothing).toBeUndefined()
  })

  it('fills a broken or empty style with defaults', () => {
    expect(normalizeStyle(null)).toEqual(defaultStyle())
    expect(normalizeStyle({ cursor: { smoothing: 'off' } }).motion.cursor.preset).toBe('off')
    expect(normalizeStyle(defaultStyle())).toEqual(defaultStyle())
  })
})

describe('click sound', () => {
  it('places clicks in output time through cuts and speed changes', () => {
    const pieces = buildPieces(edit({ cuts: [{ id: 'c', start: 2000, end: 3000 }], speeds: [{ id: 's', start: 4000, end: 6000, speed: 2 }] }), 10000)
    const ev = [...click(1000, 5, 5), ...click(2500, 5, 5), ...click(5000, 5, 5), { type: 'down' as const, t: 7000, x: 1, y: 1, button: 2 as const }]
    // 1000 -> 1000; 2500 is cut; 5000 -> 3000 + 1000 / 2 = 3500.
    expect(clickOutputTimes(ev, pieces)).toEqual([1000, 3500])
  })

  it('synthesizes a short, bounded click and encodes it as WAV', () => {
    const s = synthClick(48000)
    expect(s.length).toBeGreaterThan(1000)
    expect(Math.max(...Array.from(s, Math.abs))).toBeLessThanOrEqual(1)
    expect(Math.abs(s[s.length - 1])).toBeLessThan(0.01)
    const wav = encodeWav(s, 48000)
    expect(wav.length).toBe(44 + s.length * 2)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
  })
})

describe('camera & layout', () => {
  const z = { id: 'z', start: 1000, end: 5000, zoom: 2, mode: 'fixed' as const, target: { x: 0.9, y: 0.9 }, auto: false }

  const style = defaultStyle()
  const out = outputSize(style, size, 1080)
  const screen = screenRect(style, size, out)
  const ratio = { x: out.width / screen.width, y: out.height / screen.height }
  const track = (zooms: ZoomSegment[], cursor: Track | null = null) => buildCameraTrack(zooms, 10000, cursor, size, style.crop, ratio)

  it('zooms in during a segment and back out after it', () => {
    const cam = track([z])
    expect(viewportAt(cam, 900).scale).toBe(1)
    expect(viewportAt(cam, 1200).scale).toBeGreaterThan(1)
    expect(viewportAt(cam, 1200).scale).toBeLessThan(2)
    expect(viewportAt(cam, 3000).scale).toBeCloseTo(2, 2)
    expect(viewportAt(cam, 6500).scale).toBeCloseTo(1, 2)
  })

  it('moves continuously without jumps', () => {
    const cam = track([z, { ...z, id: 'z2', start: 5200, end: 8000, target: { x: 0.1, y: 0.2 } }])
    let prev = viewportAt(cam, 0)
    for (let t = 5; t < 10000; t += 5) {
      const vp = viewportAt(cam, t)
      expect(Math.abs(vp.scale - prev.scale)).toBeLessThan(0.03)
      expect(Math.abs(vp.fx - prev.fx)).toBeLessThan(0.02)
      expect(Math.abs(vp.fy - prev.fy)).toBeLessThan(0.02)
      prev = vp
    }
  })

  it('keeps the zoomed view inside the screen throughout', () => {
    const cam = track([z])
    for (let t = 0; t < 10000; t += 20) {
      const tr = sceneTransform(viewportAt(cam, t), screen, out)
      if (tr.scale < 1 / Math.min(screen.width / out.width, screen.height / out.height)) continue
      // Visible content region in scene coordinates, once the screen fills the frame.
      expect(-tr.tx / tr.scale).toBeGreaterThanOrEqual(screen.x - 0.5)
      expect((out.width - tr.tx) / tr.scale).toBeLessThanOrEqual(screen.x + screen.width + 0.5)
      expect(-tr.ty / tr.scale).toBeGreaterThanOrEqual(screen.y - 0.5)
      expect((out.height - tr.ty) / tr.scale).toBeLessThanOrEqual(screen.y + screen.height + 0.5)
    }
  })

  it('pans between nearby zooms instead of zooming out', () => {
    const cam = track([z, { ...z, id: 'z2', start: 5500, end: 9000, target: { x: 0.1, y: 0.1 } }])
    for (let t = 3000; t < 8000; t += 20) expect(viewportAt(cam, t).scale).toBeGreaterThan(1.8)
  })

  it('follows the cursor only once it leaves the dead zone', () => {
    const follow = { ...z, mode: 'follow' as const, target: { x: 0.5, y: 0.5 }, auto: true }
    const n = 1300
    const xs = new Float32Array(n)
    const ys = new Float32Array(n).fill(size.height / 2)
    // Small wiggle around the center until 5 s, then a move to the right edge.
    for (let i = 0; i < n; i++) xs[i] = i * 10 < 5000 ? size.width * (0.5 + 0.03 * Math.sin(i / 5)) : size.width * 0.95
    const cam = track([{ ...follow, end: 9000 }], { step: 10, start: 0, xs, ys })
    expect(viewportAt(cam, 4000).fx).toBeCloseTo(0.5, 3)
    expect(viewportAt(cam, 7500).fx).toBeGreaterThan(0.7)
  })

  describe('smoothness on realistic recordings', () => {
    /** Cursor moves through (t, x, y) keyframes (normalized), with optional jitter, plus clicks. */
    const recording = (dur: number, keys: [number, number, number][], clicks: number[], wiggle = 0) => {
      const at = (t: number) => {
        let i = 0
        while (i < keys.length - 1 && keys[i + 1][0] <= t) i++
        const [ta, xa, ya] = keys[i]
        const [tb, xb, yb] = keys[Math.min(i + 1, keys.length - 1)]
        const f = tb === ta ? 0 : Math.min(1, Math.max(0, (t - ta) / (tb - ta)))
        const e = f * f * (3 - 2 * f)
        return {
          x: (xa + (xb - xa) * e + wiggle * Math.sin(t / 170)) * size.width,
          y: (ya + (yb - ya) * e + wiggle * 0.7 * Math.cos(t / 210)) * size.height
        }
      }
      const ev: InputEvent[] = []
      for (let t = 0; t <= dur; t += 8) ev.push({ type: 'move', t, ...at(t) })
      for (const c of clicks) ev.push(...click(c, at(c).x, at(c).y))
      ev.sort((a, b) => a.t - b.t)
      const zooms = generateAutoZooms(ev, dur, size)
      const cam = buildCameraTrack(zooms, dur, buildCursorModel(ev, dur, { spring: CURSOR_PRESETS.quick }).smooth, size, style.crop, ratio)
      return { zooms, view: (t: number) => sceneTransform(viewportAt(cam, t), screen, out) }
    }

    /** Samples the visible rect at 120 Hz: largest frame-to-frame jump in camera speed, and travel while zoomed. */
    const motion = (view: (t: number) => { scale: number; tx: number; ty: number }, dur: number) => {
      const dt = 1000 / 120
      const rect = (t: number) => {
        const tr = view(t)
        return { l: -tr.tx / tr.scale, r: (out.width - tr.tx) / tr.scale, t: -tr.ty / tr.scale, b: (out.height - tr.ty) / tr.scale, s: tr.scale }
      }
      let prev = rect(0)
      let prevV = 0
      let maxSpeedJump = 0
      let travel = 0
      for (let t = dt; t < dur; t += dt) {
        const r = rect(t)
        const v = Math.max(Math.abs(r.l - prev.l), Math.abs(r.r - prev.r), Math.abs(r.t - prev.t), Math.abs(r.b - prev.b)) / (dt / 1000)
        if (t > 2 * dt) maxSpeedJump = Math.max(maxSpeedJump, Math.abs(v - prevV))
        if (r.s > 1.05) travel += Math.hypot((r.l + r.r - prev.l - prev.r) / 2, (r.t + r.b - prev.t - prev.b) / 2)
        prev = r
        prevV = v
      }
      return { maxSpeedJump, travel }
    }

    // Thresholds sit between the old engine (corner 1131 px/s, close 903 px/s, follow drift 522 px)
    // and the new one (373, 373, 39): the old engine fails every one of these checks.
    it('zooms into a corner without jolts', () => {
      const r = recording(7000, [[0, 0.5, 0.5], [900, 0.5, 0.5], [1500, 0.93, 0.9], [4800, 0.93, 0.9], [5600, 0.45, 0.5]], [2000, 2600])
      expect(motion(r.view, 7000).maxSpeedJump).toBeLessThan(600)
    })

    it('goes from one zoom to the next without zooming out in between', () => {
      const r = recording(8500, [[0, 0.5, 0.5], [700, 0.2, 0.25], [3300, 0.2, 0.25], [4000, 0.78, 0.75], [8500, 0.78, 0.75]], [1500, 4550])
      expect(r.zooms).toHaveLength(2)
      expect(motion(r.view, 8500).maxSpeedJump).toBeLessThan(600)
      for (let t = r.zooms[0].start + 800; t < r.zooms[1].end - 800; t += 20) expect(r.view(t).scale).toBeGreaterThan(1.5)
    })

    it('keeps the camera still while the mouse only jiggles', () => {
      const r = recording(9000, [[0, 0.45, 0.5], [9000, 0.55, 0.52]], [1500, 3000, 4500, 6000], 0.04)
      const m = motion(r.view, 9000)
      expect(m.maxSpeedJump).toBeLessThan(600)
      expect(m.travel).toBeLessThan(150)
    })
  })

  it('reaches 90% of a zoom in about 0.4 s and is fully out by the segment end', () => {
    const cam = track([z])
    let reached = 0
    for (let t = 1000; t < 3000; t += 5) {
      if (viewportAt(cam, t).scale >= 1 + 0.9 * (2 - 1)) {
        reached = t - 1000
        break
      }
    }
    expect(reached).toBeGreaterThan(300)
    expect(reached).toBeLessThan(500)
    expect(viewportAt(cam, 5000).scale).toBeLessThan(1.15)
  })

  it('zooms straight in and straight out, without sliding back and forth', () => {
    const cam = track([z])
    // In: the view center only ever moves towards the target. Out: only ever back to the middle.
    let prev = viewportAt(cam, 1000).fx
    for (let t = 1010; t <= 3500; t += 10) {
      const fx = viewportAt(cam, t).fx
      expect(fx).toBeGreaterThanOrEqual(prev - 1e-5)
      prev = fx
    }
    expect(prev).toBeGreaterThan(0.69)
    for (let t = 4000; t <= 7000; t += 10) {
      const fx = viewportAt(cam, t).fx
      expect(fx).toBeLessThanOrEqual(prev + 1e-5)
      expect(fx).toBeGreaterThanOrEqual(0.5 - 1e-5)
      prev = fx
    }
    expect(prev).toBeCloseTo(0.5, 4)
  })

  it('re-centers on the cursor after it moves away, starting as the cursor starts', () => {
    const follow = { ...z, mode: 'follow' as const, end: 9000 }
    const n = 1300
    const xs = new Float32Array(n)
    const ys = new Float32Array(n).fill(size.height / 2)
    // Rest at 40% of the width, glide to 60% between 3.0 s and 3.6 s.
    for (let i = 0; i < n; i++) {
      const f = Math.min(1, Math.max(0, (i * 10 - 3000) / 600))
      xs[i] = size.width * (0.4 + 0.2 * f * f * (3 - 2 * f))
    }
    const cam = track([follow], { step: 10, start: 0, xs, ys })
    expect(viewportAt(cam, 2500).fx).toBeCloseTo(0.4, 2)
    // Already moving before the cursor is halfway.
    expect(viewportAt(cam, 3300).fx).toBeGreaterThan(0.41)
    // Ends with the cursor near the middle of the frame (35-65% of its width).
    const end = viewportAt(cam, 5500)
    const half = ratio.x / end.scale / 2
    const inView = (0.6 - (end.fx - half)) / (2 * half)
    expect(inView).toBeGreaterThan(0.35)
    expect(inView).toBeLessThan(0.65)
  })

  it('a disabled zoom keeps the view still', () => {
    const cam = track([{ ...z, disabled: true }])
    for (let t = 0; t < 10000; t += 100) expect(viewportAt(cam, t).scale).toBe(1)
  })

  it('snap to edges lets the view reach into the padding at a nearby edge', () => {
    const edge = { ...z, target: { x: 0.97, y: 0.5 } }
    const plain = viewportAt(track([edge]), 3500)
    const snapped = viewportAt(track([{ ...edge, snapEdges: 1 }]), 3500)
    expect(snapped.fx).toBeGreaterThan(plain.fx + 0.01)
    // Never further than the padding allows: the frame never shows past the output.
    const tr = sceneTransform(snapped, screen, out)
    expect((out.width - tr.tx) / tr.scale).toBeLessThanOrEqual(out.width + 0.5)
  })

  it('a bouncy custom spring still keeps the view inside the screen', () => {
    const bouncy = { tension: 400, friction: 6, mass: 1 }
    const cam = buildCameraTrack([z], 10000, null, size, style.crop, ratio, bouncy)
    for (let t = 0; t < 10000; t += 10) {
      const tr = sceneTransform(viewportAt(cam, t), screen, out)
      if (tr.scale < 1 / Math.min(screen.width / out.width, screen.height / out.height)) continue
      expect((out.width - tr.tx) / tr.scale).toBeLessThanOrEqual(screen.x + screen.width + 0.5)
      expect((out.height - tr.ty) / tr.scale).toBeLessThanOrEqual(screen.y + screen.height + 0.5)
    }
  })

  it('draws an inset bezel around a smaller screen', () => {
    const inset = { ...style, inset: { enabled: true, width: 20, color: '#fff' } }
    const inner = screenRect(inset, size, out)
    const card = cardRect(inset, inner, out)
    expect(inner.width).toBeLessThan(screen.width)
    expect(card.width).toBeCloseTo(inner.width + 40, 5)
    expect(card.x).toBeCloseTo(inner.x - 20, 5)
  })

  it('makes a portrait camera bubble when asked', () => {
    const cam = cameraRect({ ...style, camera: { ...style.camera, shape: 'rounded', aspect: 0.5625 } }, out)
    expect(cam.height).toBeGreaterThan(cam.width)
    expect(cam.width / cam.height).toBeCloseTo(0.5625, 3)
    const circle = cameraRect({ ...style, camera: { ...style.camera, shape: 'circle', aspect: 0.5625 } }, out)
    expect(circle.width).toBe(circle.height)
  })

  it('is the identity when not zoomed', () => {
    const tr = sceneTransform(viewportAt(track([]), 0), screen, out)
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
