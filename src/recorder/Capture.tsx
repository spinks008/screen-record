// Hidden window that records microphone, system audio (loopback) and webcam with MediaRecorder,
// streaming chunks to the main process which writes them to the project folder.
import { useEffect } from 'react'
import { api } from '../lib/api'

type Track = 'mic' | 'system' | 'camera'

interface Active {
  track: Track
  stream: MediaStream
  recorder: MediaRecorder
  pending: Promise<void>
}

let active: Active[] = []

function pickMime(kind: 'audio' | 'video'): string {
  const options =
    kind === 'audio'
      ? ['audio/webm;codecs=opus', 'audio/webm']
      : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

function startRecorder(track: Track, stream: MediaStream): Promise<number> {
  const isVideo = track === 'camera'
  const recorder = new MediaRecorder(stream, {
    mimeType: pickMime(isVideo ? 'video' : 'audio'),
    audioBitsPerSecond: 160_000,
    videoBitsPerSecond: isVideo ? 8_000_000 : undefined
  })
  const entry: Active = { track, stream, recorder, pending: Promise.resolve() }
  // Chain sends so chunks reach the file in order even though arrayBuffer() is async.
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return
    entry.pending = entry.pending.then(async () => window.bridge.send('capture:chunk', track, await e.data.arrayBuffer()))
  }
  active.push(entry)
  return new Promise((resolve, reject) => {
    recorder.onstart = () => resolve(Date.now())
    recorder.onerror = (e) => reject(new Error(`${track} recorder error: ${String((e as ErrorEvent).message ?? e)}`))
    recorder.start(1000)
  })
}

async function start(opts: { mic: string | null; system: boolean; camera: string | null }): Promise<Record<string, number>> {
  await stopAll()
  const tasks: Promise<[Track, number]>[] = []
  if (opts.mic) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: opts.mic }, echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    })
    tasks.push(startRecorder('mic', stream).then((t) => ['mic', t]))
  }
  if (opts.system) {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      // Only the loopback audio is needed; the screen itself is captured by FFmpeg.
      display.getVideoTracks().forEach((t) => t.stop())
      const audio = new MediaStream(display.getAudioTracks())
      if (audio.getAudioTracks().length) tasks.push(startRecorder('system', audio).then((t) => ['system', t]))
    } catch (err) {
      console.warn('System audio unavailable', err)
    }
  }
  if (opts.camera) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: opts.camera }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
    })
    tasks.push(startRecorder('camera', stream).then((t) => ['camera', t]))
  }
  const results = await Promise.all(tasks)
  return Object.fromEntries(results)
}

function stopAll(): Promise<void> {
  const all = active
  active = []
  return Promise.all(
    all.map(
      (entry) =>
        new Promise<void>((resolve) => {
          const { recorder, stream } = entry
          const done = (): void => {
            stream.getTracks().forEach((t) => t.stop())
            // The final dataavailable fires before stop; wait for its send to finish.
            setTimeout(() => void entry.pending.then(resolve), 50)
          }
          if (recorder.state === 'inactive') return done()
          recorder.onstop = done
          recorder.stop()
        })
    )
  ).then(() => undefined)
}

export function Capture(): React.JSX.Element {
  useEffect(() => {
    const handle =
      (channel: string, fn: (msg: any) => Promise<unknown>) =>
      async (msg: { id: string }): Promise<void> => {
        try {
          api.reply(channel, msg.id, (await fn(msg)) ?? {})
        } catch (err) {
          api.reply(channel, msg.id, { error: (err as Error).message })
        }
      }
    const offs = [
      api.on('capture:start', handle('capture:start', start)),
      api.on('capture:stop', handle('capture:stop', stopAll)),
      api.on(
        'capture:pause',
        handle('capture:pause', async () => active.forEach((a) => a.recorder.state === 'recording' && a.recorder.pause()))
      ),
      api.on(
        'capture:resume',
        handle('capture:resume', async () => active.forEach((a) => a.recorder.state === 'paused' && a.recorder.resume()))
      )
    ]
    return () => offs.forEach((o) => o())
  }, [])
  return <div />
}
