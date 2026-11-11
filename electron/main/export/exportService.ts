// Receives the rendered (silent) video from the editor, then mixes audio and/or converts to GIF with FFmpeg.
import { app } from 'electron'
import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import type { ExportOptions, Project } from '@shared/types'
import { buildPieces, outputDuration } from '../../../src/engine/timeline'
import { clickOutputTimes, encodeWav, synthClick } from '../../../src/engine/clickSound'
import { probeHasAudio, runFfmpegOrThrow } from '../recorder/ffmpeg'
import { defaultExportFolder } from '../paths'
import { loadEvents, loadProject, projectDir } from '../projects/store'
import { getSettings } from '../settings'

interface Job {
  projectId: string
  tmp: string
  fd: number
  abort: AbortController
}

const jobs = new Map<string, Job>()

export function beginExport(projectId: string): string {
  const token = Math.random().toString(36).slice(2)
  const tmp = join(app.getPath('temp'), `screen-record-${token}.mp4`)
  jobs.set(token, { projectId, tmp, fd: openSync(tmp, 'w'), abort: new AbortController() })
  return token
}

export function writeExport(token: string, position: number, data: Uint8Array): void {
  const job = jobs.get(token)
  if (!job) throw new Error('Unknown export')
  writeSync(job.fd, data, 0, data.byteLength, position)
}

export function cancelExport(token: string): void {
  const job = jobs.get(token)
  if (!job) return
  job.abort.abort()
  try {
    closeSync(job.fd)
  } catch {
    /* already closed */
  }
  rmSync(job.tmp, { force: true })
  jobs.delete(token)
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Recording'
}

function uniquePath(folder: string, base: string, ext: string): string {
  let p = join(folder, `${base}.${ext}`)
  for (let i = 2; existsSync(p); i++) p = join(folder, `${base} (${i}).${ext}`)
  return p
}

function atempoChain(speed: number): string {
  const parts: string[] = []
  let s = speed
  while (s < 0.5) {
    parts.push('atempo=0.5')
    s /= 0.5
  }
  while (s > 100) {
    parts.push('atempo=100')
    s /= 100
  }
  if (Math.abs(s - 1) > 1e-3) parts.push(`atempo=${s.toFixed(5)}`)
  return parts.join(',')
}

/** Builds the audio filter graph: align tracks, mix, then apply cuts/speed exactly like the video. */
async function audioGraph(project: Project): Promise<{ inputs: string[]; filter: string } | null> {
  const dir = projectDir(project.id)
  const tracks: { file: string; offset: number; volume: number }[] = []
  const { audio } = project.edit.style
  if (project.files.mic && !audio.mic.muted && audio.mic.volume > 0) {
    tracks.push({ file: join(dir, project.files.mic), offset: project.offsets.mic, volume: audio.mic.volume })
  }
  if (project.files.system && !audio.system.muted && audio.system.volume > 0) {
    tracks.push({ file: join(dir, project.files.system), offset: project.offsets.system, volume: audio.system.volume })
  }
  const usable: typeof tracks = []
  for (const t of tracks) if (existsSync(t.file) && (await probeHasAudio(t.file))) usable.push(t)
  if (!usable.length) return null

  const pieces = buildPieces(project.edit, project.durationMs)
  if (!pieces.length) return null
  const chains: string[] = []
  usable.forEach((t, i) => {
    const align =
      t.offset > 0
        ? `adelay=${t.offset}:all=1`
        : t.offset < 0
          ? `atrim=start=${(-t.offset / 1000).toFixed(3)},asetpts=PTS-STARTPTS`
          : 'anull'
    chains.push(`[${i + 1}:a]aresample=48000,${align},volume=${t.volume.toFixed(3)},apad[t${i}]`)
  })
  const mixed = usable.length > 1 ? `${usable.map((_, i) => `[t${i}]`).join('')}amix=inputs=${usable.length}:normalize=0:duration=longest[mix]` : `[t0]anull[mix]`
  chains.push(mixed)
  chains.push(`[mix]asplit=${pieces.length}${pieces.map((_, i) => `[s${i}]`).join('')}`)
  pieces.forEach((p, i) => {
    const tempo = atempoChain(p.speed)
    chains.push(
      `[s${i}]atrim=start=${(p.srcStart / 1000).toFixed(4)}:end=${(p.srcEnd / 1000).toFixed(4)},asetpts=PTS-STARTPTS${tempo ? ',' + tempo : ''}[p${i}]`
    )
  })
  chains.push(`${pieces.map((_, i) => `[p${i}]`).join('')}concat=n=${pieces.length}:v=0:a=1,apad[aout]`)
  return { inputs: usable.map((t) => t.file), filter: chains.join(';') }
}

const CLICK_TRACK_RATE = 24000

/**
 * Renders every click into one WAV laid out in output time (cuts and speed already applied),
 * so it mixes onto the finished soundtrack without touching the source-time graph.
 */
function writeClickTrack(project: Project, tmpBase: string): string | null {
  const sound = project.edit.style.cursor.clickSound
  if (!sound?.enabled || sound.volume <= 0) return null
  const times = clickOutputTimes(loadEvents(project.id), buildPieces(project.edit, project.durationMs))
  if (!times.length) return null
  const click = synthClick(CLICK_TRACK_RATE)
  const length = Math.ceil(((times[times.length - 1] + 100) / 1000) * CLICK_TRACK_RATE) + click.length
  const track = new Float32Array(length)
  for (const t of times) {
    const at = Math.round((t / 1000) * CLICK_TRACK_RATE)
    for (let i = 0; i < click.length && at + i < length; i++) track[at + i] += click[i]
  }
  const file = `${tmpBase}-clicks.wav`
  writeFileSync(file, encodeWav(track, CLICK_TRACK_RATE))
  return file
}

function progressParser(totalMs: number, onProgress: (p: number) => void): (chunk: string) => void {
  return (chunk) => {
    const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(chunk)
    if (m && totalMs > 0) {
      const ms = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
      onProgress(Math.min(1, ms / totalMs))
    }
  }
}

export async function finishExport(token: string, opts: ExportOptions, onProgress: (p: number) => void): Promise<string> {
  const job = jobs.get(token)
  if (!job) throw new Error('Unknown export')
  closeSync(job.fd)
  let clickFile: string | null = null
  try {
    const project = loadProject(job.projectId)
    const folder = getSettings().exportFolder ?? defaultExportFolder()
    mkdirSync(folder, { recursive: true })
    const base = safeName(project.name)
    const totalMs = outputDuration(buildPieces(project.edit, project.durationMs))
    const signal = job.abort.signal

    if (opts.format === 'gif') {
      const out = uniquePath(folder, base, 'gif')
      const width = Math.min(960, Math.round((opts.height * 16) / 9))
      const fps = Math.min(opts.fps, 20)
      await runFfmpegOrThrow(
        [
          '-y', '-i', job.tmp,
          '-vf', `fps=${fps},scale='min(${width},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
          '-loop', '0', out
        ],
        progressParser(totalMs, onProgress),
        signal
      )
      return out
    }

    const out = uniquePath(folder, base, 'mp4')
    const graph = await audioGraph(project)
    clickFile = writeClickTrack(project, job.tmp)
    if (!graph && !clickFile) {
      await runFfmpegOrThrow(['-y', '-i', job.tmp, '-c', 'copy', '-movflags', '+faststart', out], undefined, signal)
      return out
    }
    const inputs = [...(graph?.inputs ?? []), ...(clickFile ? [clickFile] : [])]
    const chains = graph ? [graph.filter] : []
    let audioOut = '[aout]'
    if (clickFile) {
      const volume = project.edit.style.cursor.clickSound.volume
      chains.push(`[${inputs.length}:a]aresample=48000,volume=${volume.toFixed(3)},apad[clk]`)
      if (graph) {
        chains.push('[aout][clk]amix=inputs=2:normalize=0:duration=longest[amixed]')
        audioOut = '[amixed]'
      } else audioOut = '[clk]'
    }
    await runFfmpegOrThrow(
      [
        '-y', '-i', job.tmp,
        ...inputs.flatMap((f) => ['-i', f]),
        '-filter_complex', chains.join(';'),
        '-map', '0:v', '-map', audioOut,
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest',
        '-movflags', '+faststart', out
      ],
      progressParser(totalMs, onProgress),
      signal
    )
    return out
  } finally {
    rmSync(job.tmp, { force: true })
    if (clickFile) rmSync(clickFile, { force: true })
    jobs.delete(token)
  }
}
