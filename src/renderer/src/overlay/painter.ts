// 세계 그리기: 오버레이(화면마다)와 스튜디오(영상 만들기)가 같이 쓴다.
// view = 이 캔버스가 보여 주는 화면 좌표 영역. 확대는 부르는 쪽이 ctx.setTransform 으로.
import { ITEM_KINDS, ITEMS, MATERIALS, PORTAL_R, STRUCTURES } from '@shared/defs'
import type { FramePacket, Fx, Rect, StrokeView } from '@shared/types'
import { blit, itemSprite, movingSprite, portalColors, portalSprite, structSprite } from '@/art/dots'
import galmuri from '@/assets/fonts/Galmuri11-Bold.woff2'

export const FONT = 'WhGalmuri'
let fontLoading: Promise<void> | null = null
export function loadFont(): Promise<void> {
  fontLoading ??= new FontFace(FONT, `url(${galmuri})`).load().then((f) => {
    document.fonts.add(f)
  })
  return fontLoading
}

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

interface Stamp {
  x: number
  y: number
  born: number
  lines: string[]
  color: string
}

export interface PainterOpts {
  /** 가짜 바탕화면 + 창 상자 (헤드리스 캡처·도트 영상) */
  backdrop: boolean
  /** 창 상자 테두리 (디버그) */
  debug: boolean
  /** 도구 표시 (테두리 점선·도구 이름). 실화면 녹화 중에는 끈다 */
  chrome: boolean
}

const ITEM_BY_INDEX = ITEM_KINDS

export class Painter {
  private strokeLayer = document.createElement('canvas')
  private sctx = this.strokeLayer.getContext('2d')!
  private strokes: StrokeView[] = []
  private parts: Particle[] = []
  private stamps: Stamp[] = []
  private flash = 0
  private lastDraw = 0

  constructor(
    private ctx: CanvasRenderingContext2D,
    private view: Rect,
    public dot: number,
    public opts: PainterOpts
  ) {
    this.resize(view)
  }

  resize(view: Rect): void {
    this.view = view
    this.strokeLayer.width = Math.max(1, Math.ceil(view.w))
    this.strokeLayer.height = Math.max(1, Math.ceil(view.h))
    this.redrawStrokes()
  }

  setDot(dot: number): void {
    if (dot === this.dot) return
    this.dot = dot
    this.redrawStrokes()
  }

  setStrokes(s: StrokeView[]): void {
    this.strokes = s
    this.redrawStrokes()
  }

  clearFx(): void {
    this.parts = []
    this.stamps = []
    this.flash = 0
  }

  private snap(v: number): number {
    return Math.floor(v / this.dot) * this.dot
  }

  // ───────── 그린 선 (바뀔 때만 다시) ─────────

  private redrawStrokes(): void {
    this.sctx.clearRect(0, 0, this.strokeLayer.width, this.strokeLayer.height)
    for (const s of this.strokes) this.rasterLine(this.sctx, s.pts, MATERIALS[s.mat].color, MATERIALS[s.mat].edge, 3)
  }

  /** 선을 도트로: 선에서 r 안쪽 칸 = 색, 그 바깥 한 칸 = 테두리 */
  private rasterLine(g: CanvasRenderingContext2D, pts: number[], color: string, edge: string | null, r: number): void {
    if (pts.length < 2) return
    const dot = this.dot
    const b = this.view
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
    const k0 = Math.floor((minX - pad - b.x) / dot)
    const k1 = Math.ceil((maxX + pad - b.x) / dot)
    const j0 = Math.floor((minY - pad - b.y) / dot)
    const j1 = Math.ceil((maxY + pad - b.y) / dot)
    if (k1 < 0 || j1 < 0 || k0 * dot > b.w || j0 * dot > b.h) return
    for (let j = Math.max(0, j0); j <= j1; j++) {
      for (let k = Math.max(0, k0); k <= k1; k++) {
        const x = b.x + (k + 0.5) * dot
        const y = b.y + (j + 0.5) * dot
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

  // ───────── 효과 ─────────

  private burst(x: number, y: number, n: number, colors: string[], speed: number, life: number, grav = 600, size = 1): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.3 + Math.random() * 0.7)
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color: colors[i % colors.length], size, grav })
    }
  }

  fx(e: Fx, now: number): void {
    switch (e.t) {
      case 'hit':
        if (e.v > 0.45) this.burst(e.x, e.y, 4, ['#ffffff', '#ffd23f'], 220, 0.25)
        break
      case 'warp':
      case 'cursor-warp': {
        const [a, b] = portalColors(e.c)
        this.burst(e.x, e.y, e.t === 'warp' ? 12 : 8, [a, b, '#ffffff'], 260, 0.4, 0)
        break
      }
      case 'stick':
        this.burst(e.x, e.y, 6, ['#c8874a', '#e8d2b0'], 160, 0.35)
        break
      case 'kick':
        this.burst(e.x, e.y, 6, ['#ffd23f', '#ffffff', '#ff5c8a'], 240, 0.3, 0)
        break
      case 'bell':
        this.burst(e.x, e.y - 20, 5, ['#ffd23f', '#ffffff'], 120, 0.6, -100)
        break
      case 'splat':
        this.burst(e.x, e.y, 26, ['#ff4d5e', '#ff8fa0', '#1f6b1f', '#111111'], 420, 0.9)
        break
      case 'boom':
        this.burst(e.x, e.y, 60, ['#ffd23f', '#ff9a3c', '#ff4d4d', '#ffffff', '#3c4248'], 700, 0.9, 300, 2)
        this.flash = 1
        break
      case 'goal': {
        this.burst(e.x, e.y - 30, 70, ['#ff4d4d', '#ffd23f', '#6fe08c', '#5cb6ff', '#ff8fb0', '#b06cff', '#ffffff'], 650, 1.6, 700, 1)
        this.stamps.push({ x: e.x, y: e.y - 130, born: now, lines: goalLines(e), color: '#ffd23f' })
        break
      }
    }
  }

  // ───────── 그리기 ─────────

  /** now: 밀리초 (효과 시간), dtScale: 입자 속도 배율 (슬로모션) */
  draw(f: FramePacket | null, now: number, dtScale = 1): void {
    const ctx = this.ctx
    const t = now / 1000
    const dt = this.lastDraw ? Math.min(0.05, (now - this.lastDraw) / 1000) * dtScale : 1 / 60
    this.lastDraw = now
    const ox = this.view.x
    const oy = this.view.y
    if (!f) return
    if (this.opts.backdrop) this.drawBackdrop(f)

    // 도구를 쓰는 중: 화면 가장자리에 점선 (클릭이 막혀 있다는 표시)
    if (f.ui && this.opts.chrome) this.border(t)

    ctx.drawImage(this.strokeLayer, 0, 0)

    if (this.opts.debug && !this.opts.backdrop && f.wins) {
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
        this.dottedLine(p.x - ox, p.y - oy, q.x - ox, q.y - oy, portalColors(p.c)[0], 0.35, t)
      }
    }

    const dot = this.dot
    for (const p of f.portals) {
      const pending = p.pair === null
      const dir = pending || p.id < (p.pair ?? 0) ? 1 : -1
      blit(ctx, portalSprite(p.c, PORTAL_R, dot, Math.floor(t * 12) % 12, dir, pending), p.x - ox, p.y - oy)
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

    if (f.ui) this.drawUi(f, t)

    // 입자
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i]
      p.life -= dt
      if (p.life <= 0) {
        this.parts.splice(i, 1)
        continue
      }
      p.vy += p.grav * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= Math.pow(0.98, dt * 60)
      ctx.globalAlpha = Math.min(1, (p.life / p.max) * 2)
      ctx.fillStyle = p.color
      ctx.fillRect(this.snap(p.x - ox), this.snap(p.y - oy), dot * p.size, dot * p.size)
    }
    ctx.globalAlpha = 1

    if (f.speed) this.label(`${f.speed.kmh} km/h`, f.speed.x - ox, f.speed.y - oy - 26, f.speed.kmh > 300 ? '#ff4d4d' : '#ffd23f', 1)

    for (let i = this.stamps.length - 1; i >= 0; i--) {
      const s = this.stamps[i]
      const age = (now - s.born) / 1000
      if (age > 2.6) {
        this.stamps.splice(i, 1)
        continue
      }
      const pop = age < 0.18 ? 0.6 + (age / 0.18) * 0.7 : age < 0.3 ? 1.3 - ((age - 0.18) / 0.12) * 0.3 : 1
      ctx.globalAlpha = age > 2.1 ? (2.6 - age) / 0.5 : 1
      this.label(s.lines[0], s.x - ox, s.y - oy, s.color, 3 * pop)
      if (age > 0.25) {
        this.label(s.lines[1], s.x - ox, s.y - oy + 40, '#ffffff', 1.2)
        this.label(s.lines[2], s.x - ox, s.y - oy + 64, '#6fe08c', 1.2)
      }
      ctx.globalAlpha = 1
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,240,200,${this.flash * 0.25})`
      ctx.fillRect(0, 0, this.view.w, this.view.h)
      this.flash = Math.max(0, this.flash - 0.08 * dtScale)
    }
  }

  /** 가짜 바탕화면 + 창 (헤드리스 캡처·도트 영상) */
  private drawBackdrop(f: FramePacket): void {
    const ctx = this.ctx
    const { w: W, h: H } = this.view
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, '#2c2457')
    g.addColorStop(1, '#5c3b6e')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    // 별 몇 개
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    for (let i = 0; i < 40; i++) {
      const sx = ((i * 9301 + 49297) % 233280) / 233280
      const sy = ((i * 4567 + 1234) % 9973) / 9973
      ctx.fillRect(this.snap(sx * W), this.snap(sy * H), this.dot, this.dot)
    }
    const dot = this.dot
    for (const w of [...(f.wins ?? [])].reverse()) {
      const x = this.snap(w.x - this.view.x)
      const y = this.snap(w.y - this.view.y)
      const ww = this.snap(w.w)
      const hh = this.snap(w.h)
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.fillRect(x + dot * 2, y + dot * 2, ww, hh)
      ctx.fillStyle = '#141414'
      ctx.fillRect(x - dot, y - dot, ww + dot * 2, hh + dot * 2)
      ctx.fillStyle = '#eef0f6'
      ctx.fillRect(x, y, ww, hh)
      ctx.fillStyle = '#c9cede'
      ctx.fillRect(x, y, ww, dot * 7)
      ;['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
        ctx.fillStyle = c
        ctx.fillRect(x + dot * (3 + i * 4), y + dot * 2, dot * 3, dot * 3)
      })
      // 내용 대신 회색 줄 (내 화면 내용은 담지 않는다)
      ctx.fillStyle = '#d5d9e4'
      for (let l = 0; l < Math.min(12, (hh - dot * 14) / (dot * 7)); l++) ctx.fillRect(x + dot * 5, y + dot * (12 + l * 7), this.snap((ww - dot * 10) * (0.45 + ((l * 37 + w.id) % 50) / 100)), dot * 3)
    }
  }

  label(text: string, x: number, y: number, color: string, scale: number): void {
    const ctx = this.ctx
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

  private dottedLine(x0: number, y0: number, x1: number, y1: number, color: string, alpha: number, t: number): void {
    const ctx = this.ctx
    const dot = this.dot
    const l = Math.hypot(x1 - x0, y1 - y0)
    const step = dot * 4
    const off = (t * 40) % step
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    for (let s = off; s < l; s += step) ctx.fillRect(this.snap(x0 + ((x1 - x0) * s) / l), this.snap(y0 + ((y1 - y0) * s) / l), dot, dot)
    ctx.globalAlpha = 1
  }

  private border(t: number): void {
    const ctx = this.ctx
    const dot = this.dot
    const { w: W, h: H } = this.view
    const step = dot * 6
    const off = Math.floor(t * 20) % 2 ? dot * 3 : 0
    ctx.fillStyle = 'rgba(176,108,255,0.55)'
    for (let x = off; x < W; x += step) {
      ctx.fillRect(x, 0, dot * 3, dot)
      ctx.fillRect(x, H - dot, dot * 3, dot)
    }
    for (let y = off; y < H; y += step) {
      ctx.fillRect(0, y, dot, dot * 3)
      ctx.fillRect(W - dot, y, dot, dot * 3)
    }
  }

  private drawUi(f: FramePacket, t: number): void {
    const ctx = this.ctx
    const dot = this.dot
    const ui = f.ui!
    const ox = this.view.x
    const oy = this.view.y
    const cx = ui.cursor.x - ox
    const cy = ui.cursor.y - oy

    if (ui.stroke && ui.tool.t === 'draw') {
      const md = MATERIALS[ui.tool.mat]
      this.rasterLine(ctx, ui.stroke, md.color, md.edge, 3)
    }

    if (ui.aim) {
      const ax = ui.aim.x - ox
      const ay = ui.aim.y - oy
      // 새총 고무줄
      this.dottedLine(ax, ay, cx, cy, '#ffffff', 0.9, 0)
      // 궤적 (NaN 쌍은 웜홀로 끊김)
      const pts = ui.aim.pts
      let acc = 0
      ctx.fillStyle = '#ffffff'
      ctx.globalAlpha = 0.85
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
            ctx.fillRect(this.snap(x0 + (x1 - x0) * k), this.snap(y0 + (y1 - y0) * k), dot, dot)
          }
        }
      }
      ctx.globalAlpha = 1
      // 힘 막대
      const w = 40
      ctx.fillStyle = '#141414'
      ctx.fillRect(this.snap(ax - w / 2) - dot, this.snap(ay + 22) - dot, w + dot * 2, dot * 3)
      ctx.fillStyle = ui.aim.power > 0.9 ? '#ff4d4d' : ui.aim.power > 0.6 ? '#ffd23f' : '#6fe08c'
      ctx.fillRect(this.snap(ax - w / 2), this.snap(ay + 22), Math.max(dot, this.snap(w * ui.aim.power)), dot)
      if (ui.tool.t === 'item') {
        ctx.globalAlpha = 0.7
        blit(ctx, itemSprite(ui.tool.kind, Math.atan2(ay - cy, ax - cx), dot), ax, ay)
        ctx.globalAlpha = 1
      }
    } else if (this.opts.chrome) {
      // 놓일 것 미리보기 (흐리게)
      ctx.globalAlpha = 0.42
      if (ui.tool.t === 'item') blit(ctx, itemSprite(ui.tool.kind, -Math.PI / 4, dot), cx, cy)
      else if (ui.tool.t === 'struct') blit(ctx, structSprite(ui.tool.kind, 0, 1, dot), cx, cy)
      else if (ui.tool.t === 'portal') blit(ctx, portalSprite(0, PORTAL_R, dot, Math.floor(t * 12) % 12, 1, true), cx, cy)
      ctx.globalAlpha = 1
    }

    if (ui.hover) {
      const hp = this.hoverPos(f, ui.hover)
      if (hp) this.ring(hp.x - ox, hp.y - oy, hp.r + 6, ui.tool.t === 'erase' ? '#ff4d4d' : '#ffffff', t)
    }

    if (ui.sel) {
      const sp = this.hoverPos(f, ui.sel)
      if (sp && ui.sel.t === 'portal') this.ring(sp.x - ox, sp.y - oy, sp.r + 4, '#ffd23f', t)
      else if (sp) {
        this.ring(sp.x - ox, sp.y - oy, sp.r + 4, '#ffd23f', t)
        this.dottedLine(sp.x - ox, sp.y - oy, ui.sel.hx - ox, ui.sel.hy - oy, '#ffd23f', 0.9, 0)
        ctx.fillStyle = '#141414'
        ctx.fillRect(this.snap(ui.sel.hx - ox) - dot * 2, this.snap(ui.sel.hy - oy) - dot * 2, dot * 5, dot * 5)
        ctx.fillStyle = '#ffd23f'
        ctx.fillRect(this.snap(ui.sel.hx - ox) - dot, this.snap(ui.sel.hy - oy) - dot, dot * 3, dot * 3)
      }
    }

    if (ui.erase) this.ring(cx, cy, ui.erase, '#ff4d4d', t)

    // 커서 옆 도구 이름
    if (this.opts.chrome && cx >= 0 && cy >= 0 && cx <= this.view.w && cy <= this.view.h) this.label(toolName(f), cx + 18, cy + 30, '#ffffff', 1)
  }

  private hoverPos(f: FramePacket, h: { t: string; id: number }): { x: number; y: number; r: number } | null {
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
      const s = this.strokes.find((o) => o.id === h.id)
      if (s) {
        this.ctx.globalAlpha = 0.6
        this.rasterLine(this.ctx, s.pts, '#ff4d4d', null, 4)
        this.ctx.globalAlpha = 1
      }
    }
    return null
  }

  private ring(x: number, y: number, r: number, color: string, t: number): void {
    const dot = this.dot
    const n = Math.max(12, Math.round((r * 2 * Math.PI) / (dot * 3)))
    this.ctx.fillStyle = color
    for (let i = 0; i < n; i++) {
      if ((i + Math.floor(t * 8)) % 2) continue
      const a = (i / n) * Math.PI * 2
      this.ctx.fillRect(this.snap(x + Math.cos(a) * r), this.snap(y + Math.sin(a) * r), dot, dot)
    }
  }
}

export function goalLines(e: Extract<Fx, { t: 'goal' }>): string[] {
  const how: string[] = []
  if (e.bounces) how.push(`튕김 ${e.bounces}`)
  if (e.portals) how.push(`웜홀 ${e.portals}`)
  return ['골인!', how.join(' · ') || '한 번에 쏙', e.attempts <= 1 ? '1트 성공!' : `${e.attempts}트 만에`]
}

function toolName(f: FramePacket): string {
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

function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
}
