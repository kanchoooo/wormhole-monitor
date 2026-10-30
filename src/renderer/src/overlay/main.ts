// 오버레이: 메인이 60Hz 로 보내는 프레임을 도트로 그린다. 계산은 하지 않는다 (효과 입자만 여기서).
import { ITEM_KINDS, ITEMS, MATERIALS, PORTAL_R, STRUCTURES } from '@shared/defs'
import type { FramePacket, Fx, OverlayInit, Rect, Settings, StrokeView } from '@shared/types'
import { blit, itemSprite, movingSprite, portalColors, portalSprite, structSprite } from '@/art/dots'
import galmuri from '@/assets/fonts/Galmuri11-Bold.woff2'
import { play, setSound } from '@/common/sound'

const api = window.overlayApi
const canvas = document.getElementById('stage') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const strokeLayer = document.createElement('canvas')
const sctx = strokeLayer.getContext('2d')!

let bounds: Rect = { x: 0, y: 0, w: 0, h: 0 }
let dot = 3
let debug = false
let backdrop = false
let frame: FramePacket | null = null
let strokes: StrokeView[] = []
let soundOn = true

const FONT = 'WhGalmuri'
void new FontFace(FONT, `url(${galmuri})`).load().then((f) => document.fonts.add(f))

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: string
  size: number
  grav: number
}
const parts: Particle[] = []

interface Stamp {
  x: number
  y: number
  born: number
  lines: string[]
  color: string
}
const stamps: Stamp[] = []
let flash = 0

api.onInit((init: OverlayInit) => {
  bounds = init.bounds
  dot = init.dot
  debug = init.debug
  backdrop = init.backdrop
  canvas.width = bounds.w
  canvas.height = bounds.h
  canvas.style.width = `${bounds.w}px`
  canvas.style.height = `${bounds.h}px`
  strokeLayer.width = bounds.w
  strokeLayer.height = bounds.h
  redrawStrokes()
})

api.onSettings((s: Settings) => {
  soundOn = s.sound
  setSound(s.sound, s.volume)
  if (s.dot !== dot) {
    dot = s.dot
    redrawStrokes()
  }
})

api.onScene((s) => {
  strokes = s.strokes
  redrawStrokes()
})

api.onFrame((f) => {
  frame = f
  for (const e of f.fx) spawnFx(e)
})

window.addEventListener(
  'wheel',
  (e) => {
    api.wheel(e.deltaY)
  },
  { passive: true }
)

// ───────── 그린 선 (바뀔 때만 다시) ─────────

function redrawStrokes(): void {
  sctx.clearRect(0, 0, strokeLayer.width, strokeLayer.height)
  for (const s of strokes) rasterLine(sctx, s.pts, MATERIALS[s.mat].color, MATERIALS[s.mat].edge, 3)
}

/** 선을 도트로: 선에서 r 안쪽 칸 = 색, 그 바깥 한 칸 = 테두리 */
function rasterLine(g: CanvasRenderingContext2D, pts: number[], color: string, edge: string | null, r: number): void {
  if (pts.length < 2) return
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i])
    maxX = Math.max(maxX, pts[i])
    minY = Math.min(minY, pts[i + 1])
    maxY = Math.max(maxY, pts[i + 1])
  }
  const pad = r + dot * 2
  const k0 = Math.floor((minX - pad - bounds.x) / dot)
  const k1 = Math.ceil((maxX + pad - bounds.x) / dot)
  const j0 = Math.floor((minY - pad - bounds.y) / dot)
  const j1 = Math.ceil((maxY + pad - bounds.y) / dot)
  if (k1 < 0 || j1 < 0 || k0 * dot > bounds.w || j0 * dot > bounds.h) return
  for (let j = Math.max(0, j0); j <= j1; j++) {
    for (let k = Math.max(0, k0); k <= k1; k++) {
      const x = bounds.x + (k + 0.5) * dot
      const y = bounds.y + (j + 0.5) * dot
      let d = Infinity
      for (let i = 0; i + 3 < pts.length; i += 2) d = Math.min(d, segDist(x, y, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]))
      if (pts.length === 2) d = Math.hypot(x - pts[0], y - pts[1])
      if (d <= r) g.fillStyle = color
      else if (edge && d <= r + dot) g.fillStyle = edge
      else continue
      g.fillRect(k * dot, j * dot, dot, dot)
    }
  }
}

function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
}

// ───────── 효과 ─────────

function burst(x: number, y: number, n: number, colors: string[], speed: number, life: number, grav = 600, size = 1): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const s = speed * (0.3 + Math.random() * 0.7)
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color: colors[i % colors.length], size, grav })
  }
}

function spawnFx(e: Fx): void {
  if (soundOn) play(e)
  switch (e.t) {
    case 'hit':
      if (e.v > 0.45) burst(e.x, e.y, 4, ['#ffffff', '#ffd23f'], 220, 0.25)
      break
    case 'warp':
    case 'cursor-warp': {
      const [a, b] = portalColors(e.c)
      burst(e.x, e.y, e.t === 'warp' ? 12 : 8, [a, b, '#ffffff'], 260, 0.4, 0)
      break
    }
    case 'stick':
      burst(e.x, e.y, 6, ['#c8874a', '#e8d2b0'], 160, 0.35)
      break
    case 'kick':
      burst(e.x, e.y, 6, ['#ffd23f', '#ffffff', '#ff5c8a'], 240, 0.3, 0)
      break
    case 'bell':
      burst(e.x, e.y - 20, 5, ['#ffd23f', '#ffffff'], 120, 0.6, -100)
      break
    case 'splat':
      burst(e.x, e.y, 26, ['#ff4d5e', '#ff8fa0', '#1f6b1f', '#111111'], 420, 0.9)
      break
    case 'boom':
      burst(e.x, e.y, 60, ['#ffd23f', '#ff9a3c', '#ff4d4d', '#ffffff', '#3c4248'], 700, 0.9, 300, 2)
      flash = 1
      break
    case 'goal': {
      burst(e.x, e.y - 30, 70, ['#ff4d4d', '#ffd23f', '#6fe08c', '#5cb6ff', '#ff8fb0', '#b06cff', '#ffffff'], 650, 1.6, 700, 1)
      const how: string[] = []
      if (e.bounces) how.push(`튕김 ${e.bounces}`)
      if (e.portals) how.push(`웜홀 ${e.portals}`)
      stamps.push({
        x: e.x,
        y: e.y - 130,
        born: performance.now(),
        lines: ['골인!', how.join(' · ') || '한 번에 쏙', e.attempts <= 1 ? '1트 성공!' : `${e.attempts}트 만에`],
        color: '#ffd23f'
      })
      break
    }
  }
}

// ───────── 그리기 ─────────

const ITEM_BY_INDEX = ITEM_KINDS

function draw(now: number): void {
  requestAnimationFrame(draw)
  const t = now / 1000
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const f = frame
  const ox = bounds.x
  const oy = bounds.y
  if (!f) return
  if (backdrop) drawBackdrop(f)

  // 도구를 쓰는 중: 화면 가장자리에 점선 (클릭이 막혀 있다는 표시)
  if (f.ui) border(t)

  ctx.drawImage(strokeLayer, 0, 0)

  if (debug && f.wins) {
    ctx.strokeStyle = 'rgba(92,182,255,0.8)'
    ctx.lineWidth = 2
    for (const w of f.wins) {
      ctx.strokeStyle = w.mode === 'dyn' ? 'rgba(111,224,140,0.9)' : w.mode === 'user' ? 'rgba(255,210,63,0.9)' : 'rgba(92,182,255,0.8)'
      ctx.strokeRect(w.x - ox + 1, w.y - oy + 1, w.w - 2, w.h - 2)
    }
  }

  // 웜홀 짝 잇는 점선 (도구를 쓰는 중에만)
  if (f.ui) {
    for (const p of f.portals) {
      if (p.pair === null || p.id > p.pair) continue
      const q = f.portals.find((o) => o.id === p.pair)
      if (!q) continue
      dottedLine(p.x - ox, p.y - oy, q.x - ox, q.y - oy, portalColors(p.c)[0], 0.35, t)
    }
  }

  for (const p of f.portals) {
    const pending = p.pair === null
    const dir = pending || p.id < (p.pair ?? 0) ? 1 : -1
    blit(ctx, portalSprite(p.c, PORTAL_R, dot, Math.floor(t * 12) % 12, dir, pending), p.x - ox, p.y - oy)
    // 나오는 방향 표시 (작은 화살)
    if (!pending) {
      const [a] = portalColors(p.c)
      const r = PORTAL_R + 7
      for (let i = 0; i < 3; i++) {
        const along = r + i * dot
        const w = (2 - i) * dot
        const cx = p.x - ox + Math.cos(p.a) * along
        const cy = p.y - oy + Math.sin(p.a) * along
        ctx.fillStyle = a
        for (let s = -w; s <= w; s += dot) ctx.fillRect(snap(cx - Math.sin(p.a) * s), snap(cy + Math.cos(p.a) * s), dot, dot)
      }
    }
  }

  for (const s of f.structs) {
    blit(ctx, structSprite(s.k, s.a, s.s, dot, t), s.x - ox, s.y - oy)
    if (s.m) blit(ctx, movingSprite(s.k, s.m.a, s.s, dot), s.m.x - ox, s.m.y - oy)
  }

  const it = f.items
  for (let i = 0; i < it.length; i += 6) {
    const kind = ITEM_BY_INDEX[it[i + 1]]
    blit(ctx, itemSprite(kind, it[i + 4], dot, (it[i + 5] & 4) !== 0), it[i + 2] - ox, it[i + 3] - oy)
  }

  if (f.ui) drawUi(f, t)

  // 입자
  const dt = 1 / 60
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    p.life -= dt
    if (p.life <= 0) {
      parts.splice(i, 1)
      continue
    }
    p.vy += p.grav * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vx *= 0.98
    ctx.globalAlpha = Math.min(1, (p.life / p.max) * 2)
    ctx.fillStyle = p.color
    ctx.fillRect(snap(p.x - ox), snap(p.y - oy), dot * p.size, dot * p.size)
  }
  ctx.globalAlpha = 1

  if (f.speed) {
    const sx = f.speed.x - ox
    const sy = f.speed.y - oy - 26
    label(`${f.speed.kmh} km/h`, sx, sy, f.speed.kmh > 300 ? '#ff4d4d' : '#ffd23f', 1)
  }

  for (let i = stamps.length - 1; i >= 0; i--) {
    const s = stamps[i]
    const age = (now - s.born) / 1000
    if (age > 2.6) {
      stamps.splice(i, 1)
      continue
    }
    const pop = age < 0.18 ? 0.6 + (age / 0.18) * 0.7 : age < 0.3 ? 1.3 - ((age - 0.18) / 0.12) * 0.3 : 1
    ctx.globalAlpha = age > 2.1 ? (2.6 - age) / 0.5 : 1
    label(s.lines[0], s.x - ox, s.y - oy, s.color, 3 * pop)
    if (age > 0.25) {
      label(s.lines[1], s.x - ox, s.y - oy + 40, '#ffffff', 1.2)
      label(s.lines[2], s.x - ox, s.y - oy + 64, '#6fe08c', 1.2)
    }
    ctx.globalAlpha = 1
  }

  if (flash > 0) {
    ctx.fillStyle = `rgba(255,240,200,${flash * 0.25})`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    flash = Math.max(0, flash - 0.08)
  }
}
requestAnimationFrame(draw)

/** 헤드리스 캡처용 가짜 바탕화면 + 창 */
function drawBackdrop(f: FramePacket): void {
  const g = ctx.createLinearGradient(0, 0, 0, canvas.height)
  g.addColorStop(0, '#3b4a7a')
  g.addColorStop(1, '#7a5a8a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.fillRect(0, canvas.height - 60, canvas.width, 60)
  for (const w of [...(f.wins ?? [])].reverse()) {
    const x = w.x - bounds.x
    const y = w.y - bounds.y
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.fillRect(x + 4, y + 6, w.w, w.h)
    ctx.fillStyle = '#f4f5f7'
    ctx.fillRect(x, y, w.w, w.h)
    ctx.fillStyle = '#d9dce3'
    ctx.fillRect(x, y, w.w, 26)
    ;['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
      ctx.fillStyle = c
      ctx.beginPath()
      ctx.arc(x + 14 + i * 18, y + 13, 5, 0, Math.PI * 2)
      ctx.fill()
    })
    ctx.fillStyle = '#c9ced8'
    for (let l = 0; l < Math.min(10, (w.h - 40) / 22); l++) ctx.fillRect(x + 16, y + 42 + l * 22, (w.w - 32) * (0.5 + ((l * 37) % 50) / 100), 8)
  }
}

function snap(v: number): number {
  return Math.floor(v / dot) * dot
}

/** 도트 글씨 (Galmuri) + 검은 테두리 */
function label(text: string, x: number, y: number, color: string, scale: number): void {
  const size = Math.round(12 * scale)
  ctx.font = `${size}px ${FONT}, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = Math.max(3, size / 4)
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#141414'
  ctx.strokeText(text, Math.round(x), Math.round(y))
  ctx.fillStyle = color
  ctx.fillText(text, Math.round(x), Math.round(y))
}

function dottedLine(x0: number, y0: number, x1: number, y1: number, color: string, alpha: number, t: number): void {
  const l = Math.hypot(x1 - x0, y1 - y0)
  const step = dot * 4
  const off = (t * 40) % step
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  for (let s = off; s < l; s += step) ctx.fillRect(snap(x0 + ((x1 - x0) * s) / l), snap(y0 + ((y1 - y0) * s) / l), dot, dot)
  ctx.globalAlpha = 1
}

function border(t: number): void {
  const step = dot * 6
  const off = Math.floor(t * 20) % 2 ? dot * 3 : 0
  ctx.fillStyle = 'rgba(176,108,255,0.55)'
  for (let x = off; x < canvas.width; x += step) {
    ctx.fillRect(x, 0, dot * 3, dot)
    ctx.fillRect(x, canvas.height - dot, dot * 3, dot)
  }
  for (let y = off; y < canvas.height; y += step) {
    ctx.fillRect(0, y, dot, dot * 3)
    ctx.fillRect(canvas.width - dot, y, dot, dot * 3)
  }
}

const TOOL_NAME = (f: FramePacket): string => {
  const tool = f.ui!.tool
  switch (tool.t) {
    case 'hand':
      return '✋ 손'
    case 'erase':
      return '지우개'
    case 'portal':
      return f.ui!.pending ? '웜홀 · 짝 놓을 곳 클릭' : '웜홀'
    case 'struct':
      return STRUCTURES[tool.kind].name
    case 'draw':
      return `그리기 · ${MATERIALS[tool.mat].name}`
    case 'item':
      return `${ITEMS[tool.kind].name} · 클릭 놓기 / 당겨서 쏘기`
    default:
      return ''
  }
}

function drawUi(f: FramePacket, t: number): void {
  const ui = f.ui!
  const ox = bounds.x
  const oy = bounds.y
  const cx = ui.cursor.x - ox
  const cy = ui.cursor.y - oy

  if (ui.stroke && ui.tool.t === 'draw') {
    const md = MATERIALS[ui.tool.mat]
    rasterLine(ctx, ui.stroke, md.color, md.edge, 3)
  }

  if (ui.aim) {
    const ax = ui.aim.x - ox
    const ay = ui.aim.y - oy
    // 새총 고무줄
    dottedLine(ax, ay, cx, cy, '#ffffff', 0.9, 0)
    // 궤적 (NaN 쌍은 웜홀로 끊김)
    const pts = ui.aim.pts
    let acc = 0
    for (let i = 2; i + 1 < pts.length; i += 2) {
      if (Number.isNaN(pts[i]) || Number.isNaN(pts[i - 2])) continue
      const x0 = pts[i - 2] - ox
      const y0 = pts[i - 1] - oy
      const x1 = pts[i] - ox
      const y1 = pts[i + 1] - oy
      const l = Math.hypot(x1 - x0, y1 - y0)
      for (let s = 0; s < l; s += 2) {
        acc += 2
        if (acc % 14 < 2) {
          const k = s / (l || 1)
          ctx.globalAlpha = 0.85
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(snap(x0 + (x1 - x0) * k), snap(y0 + (y1 - y0) * k), dot, dot)
        }
      }
    }
    ctx.globalAlpha = 1
    // 힘 막대
    const w = 40
    ctx.fillStyle = '#141414'
    ctx.fillRect(snap(ax - w / 2) - dot, snap(ay + 22) - dot, w + dot * 2, dot * 3)
    ctx.fillStyle = ui.aim.power > 0.9 ? '#ff4d4d' : ui.aim.power > 0.6 ? '#ffd23f' : '#6fe08c'
    ctx.fillRect(snap(ax - w / 2), snap(ay + 22), Math.max(dot, snap(w * ui.aim.power)), dot)
    // 놓일 장난감 미리보기
    if (ui.tool.t === 'item') {
      ctx.globalAlpha = 0.7
      blit(ctx, itemSprite(ui.tool.kind, Math.atan2(ay - cy, ax - cx), dot), ax, ay)
      ctx.globalAlpha = 1
    }
  } else if (ui.tool.t === 'item') {
    ctx.globalAlpha = 0.45
    blit(ctx, itemSprite(ui.tool.kind, -Math.PI / 4, dot), cx, cy)
    ctx.globalAlpha = 1
  } else if (ui.tool.t === 'struct') {
    ctx.globalAlpha = 0.4
    blit(ctx, structSprite(ui.tool.kind, 0, 1, dot), cx, cy)
    ctx.globalAlpha = 1
  } else if (ui.tool.t === 'portal') {
    ctx.globalAlpha = 0.4
    blit(ctx, portalSprite(0, PORTAL_R, dot, Math.floor(t * 12) % 12, 1, true), cx, cy)
    ctx.globalAlpha = 1
  }

  if (ui.hover) {
    const hp = hoverPos(f, ui.hover)
    if (hp) ring(hp.x - ox, hp.y - oy, hp.r + 6, ui.tool.t === 'erase' ? '#ff4d4d' : '#ffffff', t)
  }

  if (ui.sel) {
    const sp = hoverPos(f, ui.sel)
    if (sp) {
      ring(sp.x - ox, sp.y - oy, sp.r + 4, '#ffd23f', t)
      dottedLine(sp.x - ox, sp.y - oy, ui.sel.hx - ox, ui.sel.hy - oy, '#ffd23f', 0.9, 0)
      ctx.fillStyle = '#141414'
      ctx.fillRect(snap(ui.sel.hx - ox) - dot * 2, snap(ui.sel.hy - oy) - dot * 2, dot * 5, dot * 5)
      ctx.fillStyle = '#ffd23f'
      ctx.fillRect(snap(ui.sel.hx - ox) - dot, snap(ui.sel.hy - oy) - dot, dot * 3, dot * 3)
    }
  }

  if (ui.erase) ring(cx, cy, ui.erase, '#ff4d4d', t)

  // 커서 옆 도구 이름
  if (cx >= 0 && cy >= 0 && cx <= bounds.w && cy <= bounds.h) label(TOOL_NAME(f), cx + 18, cy + 30, '#ffffff', 1)
}

function hoverPos(f: FramePacket, h: { t: string; id: number }): { x: number; y: number; r: number } | null {
  if (h.t === 'portal') {
    const p = f.portals.find((o) => o.id === h.id)
    return p ? { x: p.x, y: p.y, r: PORTAL_R } : null
  }
  if (h.t === 'struct') {
    const s = f.structs.find((o) => o.id === h.id)
    return s ? { x: s.x, y: s.y, r: 30 * s.s } : null
  }
  if (h.t === 'item') {
    for (let i = 0; i < f.items.length; i += 6) if (f.items[i] === h.id) return { x: f.items[i + 2], y: f.items[i + 3], r: ITEMS[ITEM_BY_INDEX[f.items[i + 1]]].r }
  }
  if (h.t === 'stroke') {
    const s = strokes.find((o) => o.id === h.id)
    if (s) {
      ctx.globalAlpha = 0.6
      rasterLine(ctx, s.pts, '#ff4d4d', null, 4)
      ctx.globalAlpha = 1
    }
  }
  return null
}

function ring(x: number, y: number, r: number, color: string, t: number): void {
  const n = Math.max(12, Math.round((r * 2 * Math.PI) / (dot * 3)))
  ctx.fillStyle = color
  for (let i = 0; i < n; i++) {
    if ((i + Math.floor(t * 8)) % 2) continue
    const a = (i / n) * Math.PI * 2
    ctx.fillRect(snap(x + Math.cos(a) * r), snap(y + Math.sin(a) * r), dot, dot)
  }
}

api.ready()
