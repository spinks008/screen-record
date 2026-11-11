// Orchestrates one recording: screen (FFmpeg), mic/system audio/webcam (hidden capture renderer)
// and input events, with pause/resume, then finalizes everything into a project folder.
import { ipcMain, screen } from 'electron'
import { createWriteStream, existsSync, renameSync, rmSync, writeFileSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import type { InputEvent, Project, Rect, RecorderStatus, RecordingOptions } from '@shared/types'
import { createEdit, defaultStyle } from '../../../src/engine/defaults'
import { getSettings } from '../settings'
import { createProjectDir, deleteProject, newProjectId, saveProject } from '../projects/store'
import {
  broadcast,
  captureWindow,
  closeBubble,
  closeToolbar,
  rendererRequest,
  showCountdown,
  showToolbar,
  waitForLoad
} from '../windows'
import { probeDurationMs, runFfmpeg, runFfmpegOrThrow } from './ffmpeg'
import { InputTracker, type RawEvent } from './inputTracker'
import { ScreenSegment, normalizeCaptureRect, type CaptureTarget } from './screenCapture'
import { focusWindow, monitorAt, windowBounds } from './winApi'

type Track = 'mic' | 'system' | 'camera'

interface MediaStarted {
  mic?: number
  system?: number
  camera?: number
}

function sortedDisplays(): Electron.Display[] {
  const primary = screen.getPrimaryDisplay().id
  return [...screen.getAllDisplays()].sort((a, b) => (a.id === primary ? -1 : b.id === primary ? 1 : a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y))
}

function physicalBounds(d: Electron.Display): Rect {
  return screen.dipToScreenRect(null, d.bounds)
}

class RecordingSession {
  status: RecorderStatus = { state: 'idle', elapsedMs: 0 }
  private opts: RecordingOptions | null = null
  private projectId = ''
  private dir = ''
  private target: CaptureTarget | null = null
  private scaleFactor = 1
  private displayDip: Rect | null = null
  private displayId = 0
  private segments: ScreenSegment[] = []
  private segmentFiles: string[] = []
  private startWall = 0
  private pauses: { start: number; end: number }[] = []
  private pausedAt = 0
  private tracker = new InputTracker()
  private media: MediaStarted = {}
  private streams = new Map<Track, WriteStream>()
  private ticker: NodeJS.Timeout | null = null

  constructor() {
    ipcMain.on('capture:chunk', (_e, track: Track, data: ArrayBuffer) => {
      this.streams.get(track)?.write(Buffer.from(data))
    })
  }

  private setState(patch: Partial<RecorderStatus>): void {
    this.status = { ...this.status, ...patch }
    broadcast('recorder:status', this.status)
  }

  private elapsed(): number {
    if (!this.startWall) return 0
    const now = this.status.state === 'paused' ? this.pausedAt : Date.now()
    const paused = this.pauses.reduce((s, p) => s + (p.end - p.start), 0)
    return Math.max(0, now - this.startWall - paused)
  }

  private resolveTarget(opts: RecordingOptions): CaptureTarget {
    const displays = sortedDisplays()
    const src = opts.source
    let display: Electron.Display
    let rect: Rect
    if (src.kind === 'window') {
      const hwnd = Number(src.hwnd)
      const b = windowBounds(hwnd)
      if (!b) throw new Error('The selected window is no longer available.')
      rect = b
      display = screen.getDisplayNearestPoint(screen.screenToDipPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }))
    } else {
      display = displays.find((d) => d.id === src.displayId) ?? screen.getPrimaryDisplay()
      if (src.kind === 'area') {
        const r = src.rect
        rect = screen.dipToScreenRect(null, { x: display.bounds.x + r.x, y: display.bounds.y + r.y, width: r.width, height: r.height })
      } else rect = physicalBounds(display)
    }
    const phys = physicalBounds(display)
    const mon = monitorAt(phys.x + phys.width / 2, phys.y + phys.height / 2)
    this.scaleFactor = display.scaleFactor
    this.displayDip = display.bounds
    this.displayId = display.id
    return {
      hmonitor: mon.hmonitor,
      monitor: mon.bounds,
      rect: normalizeCaptureRect(rect, mon.bounds),
      outputIndex: Math.max(0, displays.indexOf(display))
    }
  }

  async start(opts: RecordingOptions, skipCountdown = false): Promise<void> {
    if (this.status.state !== 'idle') throw new Error('A recording is already in progress.')
    this.setState({ state: 'starting', elapsedMs: 0, error: undefined })
    try {
      this.opts = opts
      if (opts.source.kind === 'window') {
        focusWindow(Number(opts.source.hwnd))
        await new Promise((r) => setTimeout(r, 250))
      }
      this.target = this.resolveTarget(opts)
      this.projectId = newProjectId()
      this.dir = createProjectDir(this.projectId)
      this.segments = []
      this.segmentFiles = []
      this.pauses = []
      this.media = {}

      if (opts.countdown && !skipCountdown && this.displayDip) await showCountdown(this.displayDip)

      // Audio/camera first: they take longest to spin up and are aligned via their start timestamps.
      const tracks: Track[] = []
      if (opts.micDeviceId) tracks.push('mic')
      if (opts.systemAudio) tracks.push('system')
      if (opts.cameraDeviceId) tracks.push('camera')
      if (tracks.length) {
        for (const t of tracks) this.streams.set(t, createWriteStream(join(this.dir, `${t}.raw.webm`)))
        const win = captureWindow()
        await waitForLoad(win)
        this.media = await rendererRequest<MediaStarted>(win, 'capture:start', {
          mic: opts.micDeviceId,
          system: opts.systemAudio,
          camera: opts.cameraDeviceId
        })
      }

      this.tracker.start()
      await this.startSegment()
      this.startWall = this.segments[0].firstFrameAt
      showToolbar(this.displayId)
      this.setState({ state: 'recording' })
      this.ticker = setInterval(() => this.setState({ elapsedMs: this.elapsed() }), 250)
    } catch (err) {
      await this.abort()
      this.setState({ state: 'idle', error: (err as Error).message })
      throw err
    }
  }

  private async startSegment(): Promise<ScreenSegment> {
    const file = join(this.dir, `screen.part${this.segments.length}.mkv`)
    const seg = new ScreenSegment(this.target!, this.opts!.fps, file)
    await seg.start()
    this.segments.push(seg)
    this.segmentFiles.push(file)
    return seg
  }

  async pause(): Promise<void> {
    if (this.status.state !== 'recording') return
    this.pausedAt = Date.now()
    this.setState({ state: 'paused', elapsedMs: this.elapsed() })
    this.tracker.pause()
    await Promise.all([this.segments[this.segments.length - 1].stop(), this.captureCommand('capture:pause')])
  }

  async resume(): Promise<void> {
    if (this.status.state !== 'paused') return
    await this.captureCommand('capture:resume')
    const seg = await this.startSegment()
    this.pauses.push({ start: this.pausedAt, end: seg.firstFrameAt })
    this.tracker.resume()
    this.setState({ state: 'recording' })
  }

  private async captureCommand(channel: string): Promise<void> {
    if (!this.streams.size) return
    try {
      await rendererRequest(captureWindow(), channel, {})
    } catch (err) {
      console.warn(`[session] ${channel} failed`, err)
    }
  }

  /** Stops everything and builds the project. Returns its id. */
  async stop(): Promise<string> {
    if (this.status.state !== 'recording' && this.status.state !== 'paused') throw new Error('Not recording.')
    const wasPaused = this.status.state === 'paused'
    this.setState({ state: 'stopping' })
    if (this.ticker) clearInterval(this.ticker)
    closeToolbar()
    closeBubble()
    const events = this.tracker.stop()
    if (!wasPaused) await this.segments[this.segments.length - 1].stop()
    await this.stopMedia()
    try {
      const id = await this.finalize(events)
      this.reset()
      this.setState({ state: 'idle', elapsedMs: 0 })
      return id
    } catch (err) {
      this.reset()
      this.setState({ state: 'idle', error: (err as Error).message })
      throw err
    }
  }

  private async stopMedia(): Promise<void> {
    if (!this.streams.size) return
    try {
      await rendererRequest(captureWindow(), 'capture:stop', {}, 15000)
    } catch (err) {
      console.warn('[session] capture stop failed', err)
    }
    await Promise.all([...this.streams.values()].map((s) => new Promise<void>((r) => s.end(() => r()))))
    this.streams.clear()
  }

  /** Throws away the current recording. */
  async discard(): Promise<void> {
    if (this.status.state === 'idle') return
    if (this.ticker) clearInterval(this.ticker)
    closeToolbar()
    await this.abort()
    this.setState({ state: 'idle', elapsedMs: 0 })
  }

  /** Discards and immediately starts again with the same options. */
  async restart(): Promise<void> {
    const opts = this.opts
    await this.discard()
    if (opts) await this.start(opts, true)
  }

  private async abort(): Promise<void> {
    this.tracker.stop()
    await Promise.all(this.segments.map((s) => s.stop().catch(() => undefined)))
    await this.stopMedia().catch(() => undefined)
    if (this.projectId) deleteProject(this.projectId)
    this.reset()
  }

  private reset(): void {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
    this.segments = []
    this.startWall = 0
    this.projectId = ''
  }

  /** Wall-clock ms → recording time ms (paused spans removed). */
  private recTime(wall: number): number {
    let t = wall - this.startWall
    for (const p of this.pauses) {
      if (wall >= p.end) t -= p.end - p.start
      else if (wall > p.start) t -= wall - p.start
    }
    return t
  }

  private async finalize(raw: RawEvent[]): Promise<string> {
    const dir = this.dir
    const screenFile = join(dir, 'screen.mp4')
    if (this.segmentFiles.length === 1) {
      await runFfmpegOrThrow(['-y', '-i', this.segmentFiles[0], '-c', 'copy', '-movflags', '+faststart', screenFile])
    } else {
      const list = join(dir, 'segments.txt')
      writeFileSync(list, this.segmentFiles.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
      await runFfmpegOrThrow(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', screenFile])
      rmSync(list, { force: true })
    }
    for (const f of this.segmentFiles) rmSync(f, { force: true })

    // Remux MediaRecorder output so it has a duration and seek index.
    const files: Project['files'] = { screen: 'screen.mp4', events: 'events.json' }
    for (const track of ['mic', 'system', 'camera'] as Track[]) {
      const rawFile = join(dir, `${track}.raw.webm`)
      if (!existsSync(rawFile) || this.media[track] === undefined) {
        rmSync(rawFile, { force: true })
        continue
      }
      const out = join(dir, `${track}.webm`)
      const r = await runFfmpeg(['-y', '-fflags', '+genpts', '-i', rawFile, '-c', 'copy', out])
      if (r.code === 0) rmSync(rawFile, { force: true })
      else renameSync(rawFile, out)
      files[track] = `${track}.webm`
    }

    const durationMs = await probeDurationMs(screenFile)
    const { rect } = this.target!
    const inside = (x: number, y: number): { x: number; y: number } => ({ x: x - rect.x, y: y - rect.y })
    const events: InputEvent[] = []
    for (const e of raw) {
      const t = Math.round(this.recTime(e.t))
      if (t < -500 || t > durationMs + 500) continue
      if (e.type === 'key') events.push({ ...e, t })
      else events.push({ ...e, t, ...inside(e.x, e.y) } as InputEvent)
    }
    events.sort((a, b) => a.t - b.t)
    writeFileSync(join(dir, 'events.json'), JSON.stringify(events))

    const settings = getSettings()
    const preset = settings.presets.find((p) => p.id === settings.defaultPresetId)
    const size = { width: rect.width, height: rect.height }
    const style = structuredClone(preset?.style ?? defaultStyle())
    if (!files.camera) style.camera.visible = false
    const offset = (track: Track): number => (this.media[track] !== undefined ? Math.round(this.recTime(this.media[track]!)) : 0)
    const project: Project = {
      version: 1,
      id: this.projectId,
      name: `Recording ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      durationMs,
      capture: { kind: this.opts!.source.kind, width: rect.width, height: rect.height, fps: this.opts!.fps, scaleFactor: this.scaleFactor },
      files,
      offsets: { mic: offset('mic'), system: offset('system'), camera: offset('camera') },
      edit: createEdit(events, durationMs, size, style)
    }
    saveProject(project)
    await runFfmpeg(['-y', '-ss', String(Math.min(1, durationMs / 2000)), '-i', screenFile, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', join(dir, 'thumb.jpg')])
    return project.id
  }
}

export const session = new RecordingSession()
