// Renders the app icon (rounded square, gradient, white ring + red dot) to PNG without dependencies.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      // 4x4 supersampling for antialiasing
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
        const p = pixel((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size)
        r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3]
      }
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = a ? r / a : 0; raw[o + 1] = a ? g / a : 0; raw[o + 2] = a ? b / a : 0; raw[o + 3] = (a / 16) * 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
function roundRect(x, y, r) {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0), dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0)
  return Math.hypot(dx, dy) <= r
}
function icon(x, y) {
  const m = 0.04
  if (!roundRect((x - m) / (1 - 2 * m), (y - m) / (1 - 2 * m), 0.22)) return [0, 0, 0, 0]
  const t = (x + y) / 2
  const bg = [91 + (236 - 91) * t, 91 + (72 - 91) * t, 247 + (153 - 247) * t]
  const d = Math.hypot(x - 0.5, y - 0.5)
  if (d < 0.17) return [255, 59, 48, 1]
  if (d > 0.25 && d < 0.31) return [255, 255, 255, 1]
  return [...bg, 1]
}
const root = join(import.meta.dirname, '..')
mkdirSync(join(root, 'build'), { recursive: true })
writeFileSync(join(root, 'build', 'icon.png'), png(256, icon))
writeFileSync(join(root, 'resources', 'icon.png'), png(64, icon))
writeFileSync(join(root, 'resources', 'tray.png'), png(32, icon))
console.log('icons written')
