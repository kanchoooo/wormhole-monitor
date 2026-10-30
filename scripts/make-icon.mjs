// 예비 앱 아이콘 — 32×32 도트 웜홀을 32배로 키워 그린다. (지금 build/icon.png 는 Codex 로 만든 것: art-src/icon_*.png)
// 사용법: npm run icon  → build/icon-fallback.png
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const N = 32
const S = 1024 / N
const pal = {
  bg: [24, 18, 46],
  bg2: [38, 28, 72],
  rim: [12, 8, 26],
  a: [176, 108, 255],
  b: [92, 236, 220],
  c: [255, 255, 255],
  core: [6, 4, 14],
  m: [255, 210, 63],
  mh: [255, 248, 200],
  ms: [196, 128, 20]
}
const px = Array.from({ length: N }, () => Array(N).fill(null))
const cx = 15.5
const cy = 15.5
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    // 둥근 사각형 바탕 (맥 아이콘 안쪽 여백 2도트)
    const ix = Math.max(0, Math.abs(x - cx) - 9.5)
    const iy = Math.max(0, Math.abs(y - cy) - 9.5)
    const d = Math.hypot(ix, iy)
    if (d > 4.5) continue
    px[y][x] = d > 3.6 ? pal.rim : (x + y) % 2 ? pal.bg : pal.bg2
    // 소용돌이 고리: 반지름·각도에 따라 두 색이 번갈아 꼬인다
    const dx = x - cx
    const dy = (y - cy) * 1.15
    const r = Math.hypot(dx, dy)
    const t = Math.atan2(dy, dx)
    if (r < 3.2) px[y][x] = pal.core
    else if (r < 10.5) {
      const arm = Math.sin(t * 3 + r * 0.9)
      if (arm > 0.35) px[y][x] = r < 6 ? pal.c : pal.a
      else if (arm < -0.45) px[y][x] = pal.b
      else if (r < 4.6) px[y][x] = pal.a
    }
  }
}
// 웜홀에서 튀어나오는 구슬 (오른쪽 위)
const marble = ['.###.', '#+###', '#####', '####-', '.#--.']
for (let y = 0; y < 5; y++)
  for (let x = 0; x < 5; x++) {
    const c = marble[y][x]
    if (c === '.') continue
    px[3 + y][22 + x] = c === '+' ? pal.mh : c === '-' ? pal.ms : pal.m
  }
for (const [x, y] of [[21, 9], [20, 10], [19, 11]]) px[y][x] = pal.m

const W = 1024
const raw = Buffer.alloc((W * 4 + 1) * W)
for (let y = 0; y < W; y++) {
  raw[y * (W * 4 + 1)] = 0
  for (let x = 0; x < W; x++) {
    const c = px[Math.floor(y / S)][Math.floor(x / S)]
    const i = y * (W * 4 + 1) + 1 + x * 4
    if (!c) continue
    raw[i] = c[0]
    raw[i + 1] = c[1]
    raw[i + 2] = c[2]
    raw[i + 3] = 255
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(W, 4)
ihdr[8] = 8
ihdr[9] = 6
writeFileSync(
  'build/icon-fallback.png',
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
)
console.log('build/icon-fallback.png')
