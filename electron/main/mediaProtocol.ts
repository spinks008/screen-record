// media:// protocol serving project files to the renderer, with HTTP Range support
// (needed for <video> seeking and Mediabunny's UrlSource).
//   media://project/<id>/<file>   files inside a project folder
//   media://wallpaper/current     the current Windows desktop wallpaper
import { protocol } from 'electron'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { projectDir } from './projects/store'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4a': 'audio/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json'
}

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true } }
  ])
}

function resolve(url: URL): string | null {
  if (url.host === 'wallpaper') {
    const p = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper')
    return existsSync(p) ? p : null
  }
  if (url.host === 'project') {
    const [, id, file] = decodeURIComponent(url.pathname).split('/')
    if (!id || !file || basename(file) !== file) return null
    return join(projectDir(id), file)
  }
  return null
}

export function handleMediaProtocol(): void {
  protocol.handle('media', (req) => {
    const path = resolve(new URL(req.url))
    if (!path || !existsSync(path)) return new Response('Not found', { status: 404 })
    const size = statSync(path).size
    const type = MIME[extname(path).toLowerCase()] ?? (path.endsWith('TranscodedWallpaper') ? 'image/jpeg' : 'application/octet-stream')
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    }
    const range = req.headers.get('range')
    const m = range && /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      let start = m[1] ? Number(m[1]) : NaN
      let end = m[2] ? Number(m[2]) : size - 1
      if (Number.isNaN(start)) {
        start = Math.max(0, size - end)
        end = size - 1
      }
      end = Math.min(end, size - 1)
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
      }
      const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
      return new Response(body, {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) }
      })
    }
    const body = Readable.toWeb(createReadStream(path)) as ReadableStream
    return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
  })
}
