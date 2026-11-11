// FFmpeg process helpers: one-shot runs, encoder probing and probing media duration.
import { spawn } from 'node:child_process'
import { binPath } from '../paths'

export interface RunResult {
  code: number | null
  stderr: string
}

export function runFfmpeg(args: string[], onStderr?: (chunk: string) => void, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(binPath('ffmpeg'), ['-hide_banner', '-nostdin', ...args], { windowsHide: true })
    let stderr = ''
    proc.stderr.setEncoding('utf8')
    proc.stderr.on('data', (d: string) => {
      stderr = (stderr + d).slice(-20000)
      onStderr?.(d)
    })
    const abort = (): void => {
      proc.kill()
    }
    signal?.addEventListener('abort', abort, { once: true })
    proc.on('error', reject)
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', abort)
      resolve({ code, stderr })
    })
  })
}

export async function runFfmpegOrThrow(args: string[], onStderr?: (chunk: string) => void, signal?: AbortSignal): Promise<void> {
  const r = await runFfmpeg(args, onStderr, signal)
  if (signal?.aborted) throw new Error('Cancelled')
  if (r.code !== 0) throw new Error(`ffmpeg failed (${r.code}): ${r.stderr.split('\n').slice(-6).join('\n')}`)
}

export function probeDurationMs(file: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(
      binPath('ffprobe'),
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
      { windowsHide: true }
    )
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.on('error', () => resolve(0))
    proc.on('close', () => resolve(Math.round((parseFloat(out) || 0) * 1000)))
  })
}

export function probeHasAudio(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(
      binPath('ffprobe'),
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file],
      { windowsHide: true }
    )
    let out = ''
    proc.stdout.on('data', (d) => (out += d))
    proc.on('error', () => resolve(false))
    proc.on('close', () => resolve(out.trim().length > 0))
  })
}

export type H264Encoder = 'h264_nvenc' | 'h264_qsv' | 'h264_amf' | 'h264_mf' | 'libx264'

let encoderPromise: Promise<H264Encoder> | null = null

/** Picks the first hardware H.264 encoder that actually opens on this machine. */
export function pickEncoder(): Promise<H264Encoder> {
  encoderPromise ??= (async () => {
    const candidates: H264Encoder[] = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_mf']
    for (const enc of candidates) {
      const r = await runFfmpeg([
        '-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=30', '-frames:v', '5',
        '-pix_fmt', 'nv12', '-c:v', enc, '-f', 'null', '-'
      ])
      if (r.code === 0) return enc
    }
    return 'libx264'
  })()
  return encoderPromise
}

/** Encoder arguments tuned for a high-quality, easily seekable master recording. */
export function encoderArgs(enc: H264Encoder, fps: number): string[] {
  const gop = ['-g', String(fps), '-keyint_min', String(fps)]
  switch (enc) {
    case 'h264_nvenc':
      return ['-c:v', enc, '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-bf', '0', ...gop]
    case 'h264_qsv':
      return ['-c:v', enc, '-preset', 'faster', '-global_quality', '21', ...gop]
    case 'h264_amf':
      return ['-c:v', enc, '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '19', '-qp_p', '21', '-bf', '0', ...gop]
    case 'h264_mf':
      return ['-c:v', enc, '-hw_encoding', '1', '-b:v', '20M', ...gop]
    case 'libx264':
      return ['-c:v', enc, '-preset', 'ultrafast', '-crf', '20', ...gop]
  }
}
