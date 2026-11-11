// Downloads a Windows FFmpeg build (gyan.dev "essentials", which includes the
// ddagrab Desktop Duplication source and NVENC/QSV/AMF/MF encoders) into resources/bin.
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'

const URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
const binDir = join(import.meta.dirname, '..', 'resources', 'bin')
mkdirSync(binDir, { recursive: true })
if (existsSync(join(binDir, 'ffmpeg.exe')) && !process.argv.includes('--force')) {
  console.log('ffmpeg.exe already present')
  process.exit(0)
}

const work = mkdtempSync(join(tmpdir(), 'sr-ffmpeg-'))
const zip = join(work, 'ffmpeg.zip')
console.log('Downloading', URL)
const res = await fetch(URL)
if (!res.ok) throw new Error(`Download failed: ${res.status}`)
await pipeline(Readable.fromWeb(res.body), createWriteStream(zip))

const out = join(work, 'x')
mkdirSync(out)
execFileSync(process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe') : 'tar', ['-xf', zip, '-C', out])
const root = readdirSync(out).find((d) => d.startsWith('ffmpeg'))
for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) {
  copyFileSync(join(out, root, 'bin', exe), join(binDir, exe))
}
rmSync(work, { recursive: true, force: true })
console.log('Installed ffmpeg into', binDir)
