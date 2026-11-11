// Frame-accurate export: decode source frames with Mediabunny, render each output frame with the
// compositor, encode with WebCodecs (hardware H.264), stream the MP4 to the main process for audio muxing.
import { ALL_FORMATS, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, StreamTarget, UrlSource, canEncodeVideo, type WrappedCanvas } from 'mediabunny'
import type { ExportOptions, InputEvent, Project } from '@shared/types'
import { Compositor } from '../engine/compositor'
import { outputSize } from '../engine/layout'
import { buildPieces, outToSrc, outputDuration } from '../engine/timeline'
import { api, mediaUrl } from '../lib/api'

export interface ExportProgress {
  phase: 'render' | 'finish'
  progress: number
}

const BITS_PER_PIXEL = { standard: 0.07, high: 0.11, max: 0.18 }

// H.264 levels: [level_idc, max macroblocks/second, max frame size in macroblocks].
const AVC_LEVELS: [number, number, number][] = [
  [0x28, 245760, 8192],
  [0x2a, 522240, 8704],
  [0x32, 589824, 22080],
  [0x33, 983040, 36864],
  [0x34, 2073600, 36864]
]

/** High-profile codec string with the smallest level that fits the size and frame rate. */
export function avcCodecString(width: number, height: number, fps: number): string {
  const frameMbs = Math.ceil(width / 16) * Math.ceil(height / 16)
  const level = AVC_LEVELS.find(([, mbps, fs]) => frameMbs <= fs && frameMbs * fps <= mbps)?.[0] ?? 0x34
  return `avc1.6400${level.toString(16).padStart(2, '0')}`
}

type Encoding = { fullCodecString: string; hardwareAcceleration: 'prefer-hardware' | 'no-preference' | 'prefer-software' }

/** Hardware first, then whatever the browser offers, then software. */
async function pickEncoding(width: number, height: number, fps: number, bitrate: number): Promise<Encoding | null> {
  const fullCodecString = avcCodecString(width, height, fps)
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference', 'prefer-software'] as const) {
    if (await canEncodeVideo('avc', { width, height, bitrate, frameRate: fps, fullCodecString, hardwareAcceleration })) {
      return { fullCodecString, hardwareAcceleration }
    }
  }
  return null
}

async function openVideo(url: string): Promise<{ input: Input; sink: CanvasSink; first: number } | null> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS })
  const track = await input.getPrimaryVideoTrack()
  if (!track) return null
  const first = await track.getFirstTimestamp()
  return { input, sink: new CanvasSink(track, { poolSize: 2 }), first }
}

export async function exportProject(
  project: Project,
  events: InputEvent[],
  opts: ExportOptions,
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal
): Promise<string> {
  // GIFs are rendered small and at a low frame rate before conversion.
  const height = opts.format === 'gif' ? Math.min(opts.height, 720) : opts.height
  const fps = opts.format === 'gif' ? 20 : opts.fps
  const size = outputSize(project.edit.style, project.capture, height)
  const pieces = buildPieces(project.edit, project.durationMs)
  const totalMs = outputDuration(pieces)
  if (totalMs <= 0) throw new Error('Nothing to export: the whole recording is trimmed or cut.')
  const frames = Math.max(1, Math.floor((totalMs / 1000) * fps))
  const bitrate = Math.round(size.width * size.height * fps * BITS_PER_PIXEL[opts.quality])

  const encoding = await pickEncoding(size.width, size.height, fps, bitrate)
  if (!encoding) throw new Error(`This PC cannot encode H.264 at ${size.width}×${size.height} ${fps} fps. Try a lower resolution.`)

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const comp = new Compositor(canvas, size.width, size.height, true)
  comp.setProject(project, events)

  // Stable canvases the compositor textures read from; decoded frames are copied into them.
  const screenCanvas = document.createElement('canvas')
  screenCanvas.width = project.capture.width
  screenCanvas.height = project.capture.height
  const screenCtx = screenCanvas.getContext('2d')!
  let cameraCanvas: HTMLCanvasElement | null = null
  let cameraCtx: CanvasRenderingContext2D | null = null

  const screen = await openVideo(mediaUrl(project.id, project.files.screen))
  if (!screen) throw new Error('Could not read the screen recording.')
  const camera = project.files.camera && project.edit.style.camera.visible ? await openVideo(mediaUrl(project.id, project.files.camera)) : null

  const srcTimes: number[] = []
  for (let i = 0; i < frames; i++) srcTimes.push(outToSrc(pieces, (i * 1000) / fps))

  const screenFrames = screen.sink.canvasesAtTimestamps(srcTimes.map((t) => screen.first + t / 1000))
  const cameraFrames = camera?.sink.canvasesAtTimestamps(srcTimes.map((t) => camera.first + Math.max(0, (t - project.offsets.camera) / 1000)))

  const token = await api.exportBegin(project.id)
  let writeChain = Promise.resolve()
  const writable = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
    write(chunk) {
      writeChain = writeChain.then(() => api.exportWrite(token, chunk.position, chunk.data))
      return writeChain
    }
  })
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(writable, { chunked: true }) })
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate,
    keyFrameInterval: 2,
    latencyMode: 'quality',
    ...encoding
  })
  output.addVideoTrack(source, { frameRate: fps })

  try {
    await output.start()
    comp.setSources(screenCanvas, null)
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new Error('Cancelled')
      const s = (await screenFrames.next()).value as WrappedCanvas | null | undefined
      if (s) screenCtx.drawImage(s.canvas, 0, 0, screenCanvas.width, screenCanvas.height)
      if (cameraFrames) {
        const c = (await cameraFrames.next()).value as WrappedCanvas | null | undefined
        if (c) {
          if (!cameraCanvas) {
            cameraCanvas = document.createElement('canvas')
            cameraCanvas.width = c.canvas.width
            cameraCanvas.height = c.canvas.height
            cameraCtx = cameraCanvas.getContext('2d')
            comp.setSources(screenCanvas, cameraCanvas)
          }
          cameraCtx!.drawImage(c.canvas, 0, 0)
        }
      }
      comp.render(srcTimes[i], 1000 / fps)
      await source.add(i / fps, 1 / fps)
      if (i % 10 === 0) onProgress({ phase: 'render', progress: i / frames })
    }
    source.close()
    await output.finalize()
    await writeChain
  } catch (err) {
    await output.cancel().catch(() => undefined)
    await api.exportCancel(token)
    throw err
  } finally {
    await screenFrames.return(undefined)
    await cameraFrames?.return(undefined)
    screen.input.dispose()
    camera?.input.dispose()
    comp.destroy()
  }

  onProgress({ phase: 'finish', progress: 0 })
  const off = api.on('export:progress', (p: number) => onProgress({ phase: 'finish', progress: p }))
  const abort = (): void => void api.exportCancel(token)
  signal.addEventListener('abort', abort, { once: true })
  try {
    return await api.exportFinish(token, opts)
  } finally {
    off()
    signal.removeEventListener('abort', abort)
  }
}
