// Cursor-free screen capture of one monitor (optionally cropped) through FFmpeg.
// Primary path: gfxcapture (Windows.Graphics.Capture). Fallback: ddagrab (Desktop Duplication).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Rect } from '@shared/types'
import { binPath } from '../paths'
import { encoderArgs, pickEncoder } from './ffmpeg'

export interface CaptureTarget {
  hmonitor: number
  /** Monitor bounds in physical pixels. */
  monitor: Rect
  /** Region to record, physical pixels, inside the monitor. Width/height even. */
  rect: Rect
  /** Index among DXGI outputs, used by the ddagrab fallback. */
  outputIndex: number
}

function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2)
}

/** Clamps a rect to the monitor and makes its size even (required by H.264 4:2:0). */
export function normalizeCaptureRect(rect: Rect, monitor: Rect): Rect {
  const x = Math.max(monitor.x, Math.round(rect.x))
  const y = Math.max(monitor.y, Math.round(rect.y))
  const right = Math.min(monitor.x + monitor.width, Math.round(rect.x + rect.width))
  const bottom = Math.min(monitor.y + monitor.height, Math.round(rect.y + rect.height))
  return { x, y, width: even(right - x), height: even(bottom - y) }
}

function gfxSource(t: CaptureTarget, fps: number): string {
  const left = t.rect.x - t.monitor.x
  const top = t.rect.y - t.monitor.y
  const right = t.monitor.x + t.monitor.width - (t.rect.x + t.rect.width)
  const bottom = t.monitor.y + t.monitor.height - (t.rect.y + t.rect.height)
  return [
    `gfxcapture=hmonitor=${t.hmonitor}:capture_cursor=0:display_border=0:max_framerate=${fps}`,
    `:crop_left=${left}:crop_top=${top}:crop_right=${right}:crop_bottom=${bottom}`,
    `,hwdownload,format=bgra,fps=${fps},format=nv12`
  ].join('')
}

function ddaSource(t: CaptureTarget, fps: number): string {
  return [
    `ddagrab=output_idx=${t.outputIndex}:draw_mouse=0:framerate=${fps}`,
    `:offset_x=${t.rect.x - t.monitor.x}:offset_y=${t.rect.y - t.monitor.y}`,
    `:video_size=${t.rect.width}x${t.rect.height}`,
    `,hwdownload,format=bgra,format=nv12`
  ].join('')
}

/** Records one segment (between pauses) into an MKV file, which survives crashes. */
export class ScreenSegment {
  private proc: ChildProcessWithoutNullStreams | null = null
  private exited: Promise<number | null> | null = null
  private log = ''
  /** Wall-clock time (ms) of the first captured frame. */
  firstFrameAt = 0

  constructor(
    private target: CaptureTarget,
    private fps: number,
    private file: string
  ) {}

  async start(): Promise<void> {
    try {
      await this.launch('gfx')
    } catch (err) {
      console.warn('[capture] gfxcapture failed, falling back to ddagrab:', (err as Error).message)
      await this.launch('dda')
    }
  }

  private async launch(kind: 'gfx' | 'dda'): Promise<void> {
    const enc = await pickEncoder()
    const source = kind === 'gfx' ? gfxSource(this.target, this.fps) : ddaSource(this.target, this.fps)
    const args = [
      '-hide_banner', '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', source,
      ...encoderArgs(enc, this.fps),
      '-progress', 'pipe:1', '-stats_period', '0.1',
      this.file
    ]
    const proc = spawn(binPath('ffmpeg'), args, { windowsHide: true })
    this.proc = proc
    this.log = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => (this.log = (this.log + d).slice(-8000)))
    this.exited = new Promise((res) => proc.on('close', (code) => res(code)))

    await new Promise<void>((resolve, reject) => {
      let buf = ''
      let frame = 0
      const timer = setTimeout(() => {
        proc.kill()
        reject(new Error(`No frames from ${kind} within timeout. ${this.log}`))
      }, 6000)
      const onData = (d: Buffer): void => {
        buf += d.toString()
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line.startsWith('frame=')) frame = Number(line.slice(6))
          if (line.startsWith('out_time_us=') && frame > 0 && !this.firstFrameAt) {
            const outUs = Number(line.slice(12)) || 0
            this.firstFrameAt = Date.now() - outUs / 1000
            clearTimeout(timer)
            proc.stdout.off('data', onData)
            proc.stdout.resume()
            resolve()
          }
        }
      }
      proc.stdout.on('data', onData)
      proc.on('close', (code) => {
        clearTimeout(timer)
        if (!this.firstFrameAt) reject(new Error(`ffmpeg exited (${code}) before first frame: ${this.log}`))
      })
    })
  }

  /** Asks FFmpeg to finish the file cleanly; kills it if it does not exit in time. */
  async stop(): Promise<void> {
    const proc = this.proc
    if (!proc || !this.exited) return
    try {
      proc.stdin.write('q')
      proc.stdin.end()
    } catch {
      /* already closed */
    }
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 8000))
    if ((await Promise.race([this.exited, timeout])) === 'timeout') proc.kill()
    await this.exited
    this.proc = null
  }

  get errorLog(): string {
    return this.log
  }
}
