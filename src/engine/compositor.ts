// PixiJS scene that renders one output frame. Shared by the editor preview and the exporter,
// so what you see is exactly what gets exported.
import * as PIXI from 'pixi.js'
// Pixi compiles shaders with new Function(); this self-installing patch keeps our strict CSP intact.
import '@pixi/unsafe-eval'
import { MotionBlurFilter } from '@pixi/filter-motion-blur'
import { ZoomBlurFilter } from '@pixi/filter-zoom-blur'
import type { InputEvent, Project, Rect, Style } from '@shared/types'
import { buildCursorModel, cursorAt, sampleTrack, type CursorModel } from './cursor'
import { buildCameraTrack, viewportAt, type CameraTrack } from './camera'
import { buildKeyPills, pillAt, type KeyPill } from './keys'
import { cameraRect, cardRect, insetPx, sceneTransform, screenRect, sourceToScreen, type SceneTransform } from './layout'
import { GRADIENTS, MESHES, type MeshPreset } from './defaults'
import { buildPieces, type Piece } from './timeline'
import { cursorArt, CURSOR_BASE_PX } from './cursorArt'
import { cursorSpring, screenSpring } from './spring'

PIXI.settings.ROUND_PIXELS = false

export type FrameSource = HTMLVideoElement | HTMLCanvasElement

interface Derived {
  cursor: CursorModel
  pills: KeyPill[]
  pieces: Piece[]
}

function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

/** Draws a gradient/color/image background into a canvas of the output size. */
function paintBackground(style: Style, size: { width: number; height: number }, image: HTMLImageElement | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.round(size.width))
  canvas.height = Math.max(2, Math.round(size.height))
  const c = canvas.getContext('2d')!
  const bg = style.background
  if ((bg.kind === 'image' || bg.kind === 'wallpaper') && image && image.naturalWidth) {
    const s = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight)
    const w = image.naturalWidth * s
    const h = image.naturalHeight * s
    if (bg.blur > 0) c.filter = `blur(${Math.round(bg.blur * Math.min(canvas.width, canvas.height) * 0.04)}px)`
    // Overscan so a blurred edge does not show the transparent border.
    const o = bg.blur > 0 ? Math.min(canvas.width, canvas.height) * 0.05 : 0
    c.drawImage(image, (canvas.width - w) / 2 - o, (canvas.height - h) / 2 - o, w + o * 2, h + o * 2)
    return canvas
  }
  if (bg.kind === 'color') {
    c.fillStyle = bg.value
    c.fillRect(0, 0, canvas.width, canvas.height)
    return canvas
  }
  if (bg.kind === 'mesh') {
    paintMesh(c, canvas.width, canvas.height, MESHES.find((m) => m.id === bg.value) ?? MESHES[0], bg.blur)
    return canvas
  }
  const preset = GRADIENTS.find((g) => g.id === bg.value) ?? GRADIENTS[0]
  const a = ((preset.angle - 90) * Math.PI) / 180
  const r = Math.hypot(canvas.width, canvas.height) / 2
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const g = c.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  preset.stops.forEach((s, i) => g.addColorStop(i / (preset.stops.length - 1), s))
  c.fillStyle = g
  c.fillRect(0, 0, canvas.width, canvas.height)
  // Soft light blooms give flat gradients some depth.
  const bloom = c.createRadialGradient(canvas.width * 0.25, canvas.height * 0.2, 0, canvas.width * 0.25, canvas.height * 0.2, r)
  bloom.addColorStop(0, 'rgba(255,255,255,0.18)')
  bloom.addColorStop(1, 'rgba(255,255,255,0)')
  c.fillStyle = bloom
  c.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * A procedural wallpaper: soft color blobs over a base, then a few flowing ribbons of light.
 * `blur` (0..1) softens the ribbons further.
 */
export function paintMesh(c: CanvasRenderingContext2D, w: number, h: number, m: MeshPreset, blur: number): void {
  const diag = Math.hypot(w, h)
  const unit = Math.min(w, h) / 1080
  c.fillStyle = m.base
  c.fillRect(0, 0, w, h)
  // Fade each color to a transparent version of itself; fading to transparent black grays the midtones.
  const clear = (css: string): string => {
    const { color } = parseColor(css)
    return `rgba(${color >> 16},${(color >> 8) & 255},${color & 255},0)`
  }
  for (const b of m.blobs) {
    const g = c.createRadialGradient(b.x * w, b.y * h, 0, b.x * w, b.y * h, b.r * diag)
    g.addColorStop(0, b.color)
    g.addColorStop(1, clear(b.color))
    c.fillStyle = g
    c.fillRect(0, 0, w, h)
  }
  m.ribbons.forEach((color, i) => {
    const path = new Path2D()
    const y0 = (0.82 - i * 0.14) * h
    path.moveTo(-0.1 * w, y0)
    path.bezierCurveTo(0.28 * w, (0.18 + i * 0.12) * h, 0.62 * w, (1.08 - i * 0.12) * h, 1.1 * w, (0.22 + i * 0.13) * h)
    const g = c.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, clear(color))
    g.addColorStop(0.45, color)
    g.addColorStop(1, clear(color))
    c.save()
    c.strokeStyle = g
    c.lineCap = 'round'
    // A wide glow under a thinner, brighter band.
    c.globalAlpha = 0.45
    c.filter = `blur(${Math.round((60 + blur * 120) * unit)}px)`
    c.lineWidth = (240 - i * 50) * unit
    c.stroke(path)
    c.globalAlpha = 0.6
    c.filter = `blur(${Math.round((10 + blur * 80) * unit)}px)`
    c.lineWidth = (70 - i * 15) * unit
    c.stroke(path)
    c.restore()
  })
  // Gentle vignette keeps the eye on the screen card (dark wallpapers only: it muddies pastels).
  const { color } = parseColor(m.base)
  const luma = (0.299 * (color >> 16) + 0.587 * ((color >> 8) & 255) + 0.114 * (color & 255)) / 255
  if (luma < 0.5) {
    const v = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, diag * 0.6)
    v.addColorStop(0, 'rgba(0,0,0,0)')
    v.addColorStop(1, 'rgba(0,0,0,0.28)')
    c.fillStyle = v
    c.fillRect(0, 0, w, h)
  }
}

/** Parses '#rgb', '#rrggbb' or 'rgb[a](r, g, b[, a])' into a Pixi color and alpha. */
function parseColor(css: string): { color: number; alpha: number } {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim())
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (x) => x + x) : hex[1]
    return { color: parseInt(h, 16), alpha: 1 }
  }
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i.exec(css)
  if (m) return { color: (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]), alpha: m[4] === undefined ? 1 : Number(m[4]) }
  return { color: 0xffffff, alpha: 0.16 }
}

/** Pre-rendered soft shadow for the screen card. */
function paintShadow(rect: Rect, radius: number, shadow: Style['shadow'], unit: number): { canvas: HTMLCanvasElement; x: number; y: number } {
  const blur = Math.max(0, shadow.blur) * unit
  const offsetY = shadow.offsetY * unit
  const pad = blur * 2 + Math.abs(offsetY)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(2, Math.ceil(rect.width + pad * 2))
  canvas.height = Math.max(2, Math.ceil(rect.height + pad * 2))
  const c = canvas.getContext('2d')!
  c.shadowColor = `rgba(0,0,0,${Math.min(1, 0.55 * shadow.strength)})`
  c.shadowBlur = blur
  c.shadowOffsetY = offsetY
  c.fillStyle = '#000'
  c.beginPath()
  c.roundRect(pad, pad, rect.width, rect.height, radius)
  c.fill()
  // Remove the card itself, keeping only the shadow around it.
  c.globalCompositeOperation = 'destination-out'
  c.shadowColor = 'transparent'
  c.beginPath()
  c.roundRect(pad + 1, pad + 1, rect.width - 2, rect.height - 2, radius)
  c.fill()
  return { canvas, x: rect.x - pad, y: rect.y - pad }
}

export class Compositor {
  readonly renderer: PIXI.Renderer
  private stage = new PIXI.Container()
  private bg = new PIXI.Sprite()
  private scene = new PIXI.Container()
  private shadow = new PIXI.Sprite()
  private card = new PIXI.Graphics()
  private screenBox = new PIXI.Container()
  private screenMask = new PIXI.Graphics()
  private screenSprite = new PIXI.Sprite()
  private overlays = new PIXI.Container()
  private cursorSprite = new PIXI.Sprite()
  private ripple = new PIXI.Graphics()
  private cameraBox = new PIXI.Container()
  private cameraSprite = new PIXI.Sprite()
  private cameraMask = new PIXI.Graphics()
  private cameraBorder = new PIXI.Graphics()
  private keyBox = new PIXI.Container()
  private keyBg = new PIXI.Graphics()
  private keyText: PIXI.Text
  private motionBlur = new MotionBlurFilter([0, 0], 11, 0)
  private zoomBlur = new ZoomBlurFilter({ strength: 0, center: [0, 0], innerRadius: 0 })
  private cursorBlur = new MotionBlurFilter([0, 0], 9, 0)
  private cameraBlur = new PIXI.BlurFilter(0, 3)

  private project: Project | null = null
  private events: InputEvent[] = []
  private derived: Derived | null = null
  private derivedKey = ''
  private bgKey = ''
  private layoutKey = ''
  private bgImage: HTMLImageElement | null = null
  private bgImageUrl = ''
  private screenTex: PIXI.Texture | null = null
  private screenSrc: FrameSource | null = null
  private cameraTex: PIXI.Texture | null = null
  private cameraSrc: FrameSource | null = null
  private maskSprites = new Map<string, { sprite: PIXI.Sprite; mask: PIXI.Graphics; dim: PIXI.Graphics }>()
  private lastTransform: SceneTransform | null = null
  private cameraTrack: CameraTrack | null = null
  private cameraDeps: unknown[] = []
  private cursorTextures = new Map<string, PIXI.Texture>()
  onAssetLoaded: (() => void) | null = null

  constructor(view: HTMLCanvasElement, width: number, height: number, preserve = false) {
    this.renderer = new PIXI.Renderer({
      view,
      width,
      height,
      antialias: true,
      backgroundColor: 0x000000,
      backgroundAlpha: 1,
      preserveDrawingBuffer: preserve,
      powerPreference: 'high-performance'
    })
    this.keyText = new PIXI.Text('', {
      fontFamily: 'Segoe UI Variable Display, Segoe UI, sans-serif',
      fontWeight: '600',
      fill: 0xffffff,
      fontSize: 28
    })
    this.screenBox.addChild(this.screenSprite, this.overlays)
    this.screenBox.mask = this.screenMask
    this.scene.addChild(this.shadow, this.card, this.screenMask, this.screenBox, this.ripple, this.cursorSprite)
    this.cameraBox.addChild(this.cameraSprite, this.cameraMask, this.cameraBorder)
    this.cameraSprite.mask = this.cameraMask
    this.keyBox.addChild(this.keyBg, this.keyText)
    this.stage.addChild(this.bg, this.scene, this.cameraBox, this.keyBox)
  }

  /** Cursor texture for an art style and shape, created on first use. */
  private cursorTexture(style: Style['cursor']['art'], kind: string): PIXI.Texture {
    const key = `${style}:${kind}`
    let tex = this.cursorTextures.get(key)
    if (!tex) {
      tex = PIXI.Texture.from(cursorArt(style)[kind as keyof ReturnType<typeof cursorArt>].canvas)
      this.cursorTextures.set(key, tex)
    }
    return tex
  }

  get size(): { width: number; height: number } {
    return { width: this.renderer.width, height: this.renderer.height }
  }

  resize(width: number, height: number): void {
    if (width === this.renderer.width && height === this.renderer.height) return
    this.renderer.resize(width, height)
    this.bgKey = ''
    this.layoutKey = ''
  }

  setProject(project: Project, events: InputEvent[]): void {
    this.project = project
    this.events = events
    const e = project.edit
    const spring = cursorSpring(e.style.motion.cursor)
    const key = JSON.stringify([spring, e.style.cursor.typeHoldMs, e.style.keys.mode, events.length, project.durationMs])
    if (key !== this.derivedKey) {
      const cursor = buildCursorModel(events, project.durationMs, { spring, typeHoldMs: e.style.cursor.typeHoldMs })
      this.derived = {
        cursor,
        pills: buildKeyPills(events, e.style.keys.mode),
        pieces: buildPieces(e, project.durationMs)
      }
      this.derivedKey = key
    } else if (this.derived) {
      this.derived.pieces = buildPieces(e, project.durationMs)
    }
  }

  setSources(screen: FrameSource | null, camera: FrameSource | null): void {
    if (screen !== this.screenSrc) {
      this.screenTex?.destroy(true)
      this.screenSrc = screen
      this.screenTex = screen ? PIXI.Texture.from(screen, { resourceOptions: { autoPlay: false, autoLoad: true, updateFPS: 0 } }) : null
      if (this.screenTex?.baseTexture.resource instanceof PIXI.VideoResource) this.screenTex.baseTexture.resource.autoUpdate = false
      this.screenSprite.texture = this.screenTex ?? PIXI.Texture.EMPTY
      for (const m of this.maskSprites.values()) m.sprite.texture = this.screenSprite.texture
    }
    if (camera !== this.cameraSrc) {
      this.cameraTex?.destroy(true)
      this.cameraSrc = camera
      this.cameraTex = camera ? PIXI.Texture.from(camera, { resourceOptions: { autoPlay: false, autoLoad: true, updateFPS: 0 } }) : null
      if (this.cameraTex?.baseTexture.resource instanceof PIXI.VideoResource) this.cameraTex.baseTexture.resource.autoUpdate = false
      this.cameraSprite.texture = this.cameraTex ?? PIXI.Texture.EMPTY
    }
  }

  private sourceReady(src: FrameSource | null): boolean {
    if (!src) return false
    if (src instanceof HTMLVideoElement) return src.readyState >= 2 && src.videoWidth > 0
    return src.width > 0
  }

  private ensureBackground(style: Style): void {
    const bg = style.background
    const wantsImage = bg.kind === 'image' || bg.kind === 'wallpaper'
    const url = bg.kind === 'wallpaper' ? 'media://wallpaper/current' : bg.value
    if (wantsImage && url !== this.bgImageUrl) {
      this.bgImageUrl = url
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        this.bgImage = img
        this.bgKey = ''
        this.onAssetLoaded?.()
      }
      img.src = url
      this.bgImage = null
    }
    const key = JSON.stringify([bg, this.size, wantsImage && !!this.bgImage])
    if (key === this.bgKey) return
    this.bgKey = key
    const old = this.bg.texture
    this.bg.texture = PIXI.Texture.from(paintBackground(style, this.size, wantsImage ? this.bgImage : null))
    if (old !== PIXI.Texture.EMPTY) old.destroy(true)
  }

  private ensureLayout(style: Style, screen: Rect, unit: number): void {
    const out = this.size
    const key = JSON.stringify([screen, style.radius, style.shadow, style.inset, unit])
    if (key === this.layoutKey) return
    this.layoutKey = key
    const radius = style.radius * unit
    const inset = insetPx(style, out)
    const card = cardRect(style, screen, out)
    // With an inset, the content's corners follow the card's, just tighter.
    const innerRadius = inset > 0 ? Math.max(Math.min(radius, 2 * unit), radius - inset) : radius
    this.screenMask.clear().beginFill(0xffffff).drawRoundedRect(screen.x, screen.y, screen.width, screen.height, innerRadius).endFill()
    this.card.clear()
    if (inset > 0) {
      const { color, alpha } = parseColor(style.inset.color)
      this.card.beginFill(color, alpha).drawRoundedRect(card.x, card.y, card.width, card.height, radius).endFill()
      // A hairline highlight on the bezel's outer edge.
      this.card.lineStyle(Math.max(1, unit), 0xffffff, 0.18).drawRoundedRect(card.x, card.y, card.width, card.height, radius)
    }
    const old = this.shadow.texture
    if (style.shadow.strength > 0) {
      const s = paintShadow(card, radius, style.shadow, unit)
      this.shadow.texture = PIXI.Texture.from(s.canvas)
      this.shadow.position.set(s.x, s.y)
      this.shadow.visible = true
    } else this.shadow.visible = false
    if (old !== PIXI.Texture.EMPTY) old.destroy(true)
  }

  private updateMasks(project: Project, t: number, screen: Rect, srcScale: number, offX: number, offY: number): void {
    const live = new Set<string>()
    const src = project.capture
    for (const m of project.edit.masks) {
      // Fade masks in/out over 150 ms.
      const a = Math.min(1, Math.max(0, Math.min(t - m.start, m.end - t) / 150))
      if (a <= 0) continue
      live.add(m.id)
      let entry = this.maskSprites.get(m.id)
      if (!entry) {
        const sprite = new PIXI.Sprite(this.screenSprite.texture)
        sprite.filters = [new PIXI.BlurFilter(24, 4)]
        const mask = new PIXI.Graphics()
        sprite.mask = mask
        const dim = new PIXI.Graphics()
        entry = { sprite, mask, dim }
        this.overlays.addChild(sprite, mask, dim)
        this.maskSprites.set(m.id, entry)
      }
      const r = {
        x: offX + m.rect.x * src.width * srcScale,
        y: offY + m.rect.y * src.height * srcScale,
        width: m.rect.width * src.width * srcScale,
        height: m.rect.height * src.height * srcScale
      }
      entry.sprite.visible = m.kind === 'blur'
      entry.mask.visible = m.kind === 'blur'
      entry.dim.visible = m.kind === 'highlight'
      if (m.kind === 'blur') {
        entry.sprite.position.set(offX, offY)
        entry.sprite.scale.set(srcScale)
        entry.sprite.alpha = a
        entry.mask.clear().beginFill(0xffffff).drawRoundedRect(r.x, r.y, r.width, r.height, 8).endFill()
      } else {
        const g = entry.dim.clear().beginFill(0x000000, 0.6 * a)
        const S = screen
        g.drawRect(S.x, S.y, S.width, r.y - S.y)
        g.drawRect(S.x, r.y + r.height, S.width, S.y + S.height - r.y - r.height)
        g.drawRect(S.x, r.y, r.x - S.x, r.height)
        g.drawRect(r.x + r.width, r.y, S.x + S.width - r.x - r.width, r.height)
        g.endFill()
        g.lineStyle(2, 0xffffff, 0.9 * a).drawRoundedRect(r.x, r.y, r.width, r.height, 6)
      }
    }
    for (const [id, e] of this.maskSprites) {
      if (live.has(id)) continue
      e.sprite.destroy()
      e.mask.destroy()
      e.dim.destroy()
      this.maskSprites.delete(id)
    }
  }

  /** The camera path, rebuilt only when zooms, framing or the cursor model change. */
  private ensureCameraTrack(project: Project, d: Derived, screen: Rect, out: { width: number; height: number }): CameraTrack {
    const style = project.edit.style
    const ratio = { x: Math.round((out.width / screen.width) * 1000) / 1000, y: Math.round((out.height / screen.height) * 1000) / 1000 }
    const spring = screenSpring(style.motion.screen)
    const deps = [
      project.edit.zooms, d.cursor, project.durationMs, ratio.x, ratio.y,
      style.crop.x, style.crop.y, style.crop.width, style.crop.height,
      spring.tension, spring.friction, spring.mass
    ]
    if (!this.cameraTrack || deps.some((v, i) => v !== this.cameraDeps[i])) {
      const src = { width: project.capture.width, height: project.capture.height }
      this.cameraTrack = buildCameraTrack(project.edit.zooms, project.durationMs, d.cursor.hasData ? d.cursor.smooth : null, src, style.crop, ratio, spring)
      this.cameraDeps = deps
    }
    return this.cameraTrack
  }

  /**
   * Renders the frame for source time `t` (ms). `dt` is the frame interval used for motion blur.
   * Video sources must already show the right frame.
   */
  render(t: number, dt = 1000 / 60): void {
    const project = this.project
    const d = this.derived
    if (!project || !d) return
    const style = project.edit.style
    const out = this.size
    const unit = Math.min(out.width, out.height) / 1080
    const src = { width: project.capture.width, height: project.capture.height }

    this.ensureBackground(style)
    const screen = screenRect(style, src, out)
    this.ensureLayout(style, screen, unit)

    // Screen video placed so the crop fills the screen rect.
    const srcScale = screen.width / (src.width * style.crop.width)
    const offX = screen.x - style.crop.x * src.width * srcScale
    const offY = screen.y - style.crop.y * src.height * srcScale
    const screenOk = this.sourceReady(this.screenSrc)
    if (screenOk) this.screenTex?.baseTexture.update()
    this.screenSprite.visible = screenOk
    this.screenSprite.position.set(offX, offY)
    this.screenSprite.width = src.width * srcScale
    this.screenSprite.height = src.height * srcScale
    this.updateMasks(project, t, screen, srcScale, offX, offY)

    // Camera zoom/pan.
    const camera = this.ensureCameraTrack(project, d, screen, out)
    const tr = sceneTransform(viewportAt(camera, t), screen, out)
    this.scene.scale.set(tr.scale)
    this.scene.position.set(tr.tx, tr.ty)

    // Motion blur: directional for pans, radial for zooms, scaled by how far the view moved in one frame.
    // Both fade in from zero so the blur never pops on or off.
    const filters: PIXI.Filter[] = []
    const mb = style.motionBlur
    if (mb.enabled && (mb.pan > 0 || mb.zoom > 0)) {
      const prev = sceneTransform(viewportAt(camera, t - dt), screen, out)
      const cx = out.width / 2
      const cy = out.height / 2
      // How far the content under the frame center travelled on screen, in output pixels.
      const vx = ((cx - prev.tx) / prev.scale - (cx - tr.tx) / tr.scale) * tr.scale * mb.pan
      const vy = ((cy - prev.ty) / prev.scale - (cy - tr.ty) / tr.scale) * tr.scale * mb.pan
      const speed = Math.hypot(vx, vy)
      if (speed > 0.5) {
        const k = (speed - 0.5) / speed
        this.motionBlur.velocity.set(vx * k, vy * k)
        filters.push(this.motionBlur)
      }
      const zoomRate = Math.abs(tr.scale - prev.scale) / tr.scale
      const zoomStrength = Math.min(0.25, Math.max(0, zoomRate * mb.zoom - 0.001) * 6)
      if (zoomStrength > 0) {
        this.zoomBlur.center = new PIXI.Point(cx, cy)
        this.zoomBlur.strength = zoomStrength
        this.zoomBlur.innerRadius = Math.min(out.width, out.height) * 0.15
        filters.push(this.zoomBlur)
      }
    }
    this.scene.filters = filters.length ? filters : null
    this.scene.filterArea = filters.length ? new PIXI.Rectangle(0, 0, out.width, out.height) : (null as unknown as PIXI.Rectangle)
    this.lastTransform = tr

    // Cursor.
    const cs = style.cursor
    const piece = d.pieces.length ? { srcStart: d.pieces[0].srcStart, srcEnd: d.pieces[d.pieces.length - 1].srcEnd } : undefined
    if (cs.visible && d.cursor.hasData) {
      const c = cursorAt(d.cursor, t, cs, piece)
      const pos = sourceToScreen(style, src, screen, c.x, c.y)
      const art = cursorArt(cs.art)[c.kind]
      const sizePx = CURSOR_BASE_PX * project.capture.scaleFactor * srcScale * cs.size * c.scale
      this.cursorSprite.texture = this.cursorTexture(cs.art, c.kind)
      this.cursorSprite.anchor.set(art.hx, art.hy)
      this.cursorSprite.width = sizePx
      this.cursorSprite.height = sizePx
      this.cursorSprite.position.set(pos.x, pos.y)
      this.cursorSprite.alpha = c.alpha
      this.cursorSprite.visible = c.alpha > 0.01

      // Cursor blur from its own movement (camera moves are already blurred with the scene).
      this.cursorSprite.filters = null
      if (mb.enabled && mb.cursor > 0) {
        const p0 = sampleTrack(d.cursor.smooth, t - dt)
        const prevPos = sourceToScreen(style, src, screen, p0.x, p0.y)
        const bx = (pos.x - prevPos.x) * tr.scale * mb.cursor
        const by = (pos.y - prevPos.y) * tr.scale * mb.cursor
        const speed = Math.hypot(bx, by)
        if (speed > 1) {
          // Velocity is in output pixels; keep the streak at most ~1.5 cursor sizes.
          const k = (Math.min(speed, sizePx * tr.scale * 1.5) - 1) / speed
          this.cursorBlur.velocity.set(bx * k, by * k)
          this.cursorSprite.filters = [this.cursorBlur]
        }
      }

      this.ripple.clear()
      if (c.ripple >= 0 && c.alpha > 0.01) {
        const rp = sourceToScreen(style, src, screen, c.rippleX, c.rippleY)
        const e = 1 - Math.pow(1 - c.ripple, 3)
        const base = project.capture.scaleFactor * srcScale * cs.size * 0.6
        if (cs.clickEffect === 'circle') {
          // A soft disc that swells then fades.
          const radius = (10 + 14 * e) * base
          this.ripple.beginFill(0xffffff, 0.42 * (1 - c.ripple)).drawCircle(rp.x, rp.y, radius).endFill()
        } else {
          const radius = (8 + 26 * e) * base
          this.ripple.beginFill(0xffffff, 0.28 * (1 - c.ripple)).drawCircle(rp.x, rp.y, radius).endFill()
          this.ripple.lineStyle(2 * unit, 0xffffff, 0.75 * (1 - c.ripple)).drawCircle(rp.x, rp.y, radius)
        }
      }
    } else {
      this.cursorSprite.visible = false
      this.ripple.clear()
    }

    this.renderCamera(project, t, dt, out, unit)
    this.renderKeys(project, t, out, unit, d)

    this.renderer.render(this.stage)
  }

  /** Where the webcam sits at time t: the bubble blended towards fullscreen, and how hidden it is. */
  private cameraLayout(project: Project, t: number, out: { width: number; height: number }): { r: Rect; full: number; hidden: number; bubble: Rect } {
    const FADE = 300
    let full = 0
    let hidden = 0
    for (const s of project.edit.cameraSegments) {
      const a = Math.min(1, Math.max(0, Math.min(t - s.start, s.end - t) / FADE))
      if (s.layout === 'fullscreen') full = Math.max(full, easeInOut(a))
      else hidden = Math.max(hidden, easeInOut(a))
    }
    const bubble = cameraRect(project.edit.style, out)
    const r = {
      x: bubble.x + (0 - bubble.x) * full,
      y: bubble.y + (0 - bubble.y) * full,
      width: bubble.width + (out.width - bubble.width) * full,
      height: bubble.height + (out.height - bubble.height) * full
    }
    return { r, full, hidden, bubble }
  }

  private renderCamera(project: Project, t: number, dt: number, out: { width: number; height: number }, unit: number): void {
    const style = project.edit.style
    const camOk = style.camera.visible && this.sourceReady(this.cameraSrc)
    this.cameraBox.visible = camOk
    if (!camOk) return
    if (this.cameraTex) this.cameraTex.baseTexture.update()
    const { r, full, hidden, bubble } = this.cameraLayout(project, t, out)
    if (hidden >= 0.999) {
      this.cameraBox.visible = false
      return
    }
    const short = Math.min(bubble.width, bubble.height)
    const shapeRadius = style.camera.shape === 'circle' ? short / 2 : style.camera.shape === 'rounded' ? short * 0.2 : 6 * unit
    const radius = shapeRadius * (1 - full)

    // Camera blur while the bubble grows to (or shrinks from) fullscreen.
    const mb = style.motionBlur
    this.cameraBox.filters = null
    if (mb.enabled && mb.camera > 0) {
      const prev = this.cameraLayout(project, t - dt, out).r
      const moved = Math.max(Math.abs(r.x - prev.x), Math.abs(r.y - prev.y), Math.abs(r.width - prev.width), Math.abs(r.height - prev.height))
      const blur = Math.min(12, moved * mb.camera * 0.25)
      if (blur > 0.3) {
        this.cameraBlur.blur = blur
        this.cameraBox.filters = [this.cameraBlur]
      }
    }
    const tex = this.cameraSprite.texture
    const tw = tex.width || 1
    const th = tex.height || 1
    const s = Math.max(r.width / tw, r.height / th)
    this.cameraSprite.scale.set(style.camera.mirror ? -s : s, s)
    this.cameraSprite.position.set(
      r.x + r.width / 2 + ((style.camera.mirror ? 1 : -1) * tw * s) / 2,
      r.y + r.height / 2 - (th * s) / 2
    )
    this.cameraMask.clear().beginFill(0xffffff).drawRoundedRect(r.x, r.y, r.width, r.height, radius).endFill()
    this.cameraBorder.clear()
    if (full < 0.99) this.cameraBorder.lineStyle(3 * unit, 0xffffff, 0.9 * (1 - full)).drawRoundedRect(r.x, r.y, r.width, r.height, radius)
    this.cameraBox.alpha = 1 - hidden
  }

  private renderKeys(project: Project, t: number, out: { width: number; height: number }, unit: number, d: Derived): void {
    const style = project.edit.style
    const pill = style.keys.enabled ? pillAt(d.pills, t) : null
    this.keyBox.visible = !!pill
    if (!pill) return
    const fontSize = Math.round(30 * unit)
    if (this.keyText.text !== pill.label || this.keyText.style.fontSize !== fontSize) {
      this.keyText.text = pill.label
      this.keyText.style.fontSize = fontSize
    }
    const padX = 20 * unit
    const padY = 11 * unit
    const w = this.keyText.width + padX * 2
    const h = this.keyText.height + padY * 2
    this.keyBg.clear().beginFill(0x111116, 0.86).drawRoundedRect(0, 0, w, h, h / 2.6).endFill()
    this.keyBg.lineStyle(1.5 * unit, 0xffffff, 0.14).drawRoundedRect(0, 0, w, h, h / 2.6)
    this.keyText.position.set(padX, padY)
    const scale = 0.9 + 0.1 * pill.pop
    this.keyBox.scale.set(scale)
    this.keyBox.position.set((out.width - w * scale) / 2, out.height - h * scale - 36 * unit)
    this.keyBox.alpha = pill.alpha
  }

  get transform(): SceneTransform | null {
    return this.lastTransform
  }

  destroy(): void {
    this.screenTex?.destroy(true)
    this.cameraTex?.destroy(true)
    this.renderer.destroy(false)
  }
}
