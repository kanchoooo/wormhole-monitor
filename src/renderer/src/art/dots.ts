// 도트 그림: 이미지 파일 없이, 도트 칸마다 "이 칸은 무슨 색?" 을 계산해서 그린다.
// 돌아간 모양도 칸 단위로 다시 계산하므로 어느 각도·도트 크기에서도 도트 느낌이 유지된다.
// 같은 모양은 캔버스로 만들어 두고 다시 쓴다 (각도는 몇 단계로 나눠 저장).
import { ITEMS, MATERIALS, PORTAL_COLORS, STRUCTURES, type ItemKind, type Material, type Part, type StructureKind } from '@shared/defs'

export type Color = string | null

export interface Sprite {
  canvas: HTMLCanvasElement
  /** 가운데 칸 번호 (가로·세로 같음) */
  c: number
  dot: number
}

/** n×n 칸을 칠한다. fn 은 칸 중심의 (스프라이트 중심 기준) px 좌표를 받는다. edge 를 주면 바깥 테두리 한 칸을 그 색으로 */
export function raster(n: number, dot: number, fn: (x: number, y: number) => Color, edge?: (inner: string) => string): Sprite {
  if (n % 2 === 0) n++
  const c = (n - 1) / 2
  const cells: Color[] = new Array(n * n)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cells[j * n + i] = fn((i - c) * dot, (j - c) * dot)
  const canvas = document.createElement('canvas')
  canvas.width = n * dot
  canvas.height = n * dot
  const g = canvas.getContext('2d')!
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let col = cells[j * n + i]
      if (!col) continue
      if (edge) {
        const out = (a: number, b: number): boolean => a < 0 || b < 0 || a >= n || b >= n || !cells[b * n + a]
        if (out(i - 1, j) || out(i + 1, j) || out(i, j - 1) || out(i, j + 1)) col = edge(col)
      }
      g.fillStyle = col
      g.fillRect(i * dot, j * dot, dot, dot)
    }
  }
  return { canvas, c, dot }
}

/** 화면 좌표 (x,y) 에 스프라이트 가운데 칸이 오도록, 도트 격자에 맞춰 그린다 */
export function blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, ox = 0, oy = 0): void {
  const kx = Math.floor((x - ox) / s.dot)
  const ky = Math.floor((y - oy) / s.dot)
  ctx.drawImage(s.canvas, (kx - s.c) * s.dot, (ky - s.c) * s.dot)
}

const cache = new Map<string, Sprite>()
function cached(key: string, make: () => Sprite): Sprite {
  let s = cache.get(key)
  if (!s) {
    s = make()
    if (cache.size > 3000) cache.clear()
    cache.set(key, s)
  }
  return s
}

export function clearCache(): void {
  cache.clear()
}

const bucket = (a: number, steps: number): number => {
  const b = Math.round((a / (Math.PI * 2)) * steps) % steps
  return b < 0 ? b + steps : b
}

const shadeEdge = (dark: string) => () => dark

// ───────── 장난감 ─────────

type Shader = (u: number, v: number, d: number, lx: number, ly: number) => string

/** 공 무늬: (u,v) = 공과 같이 도는 좌표(-1~1), d = 중심 거리(0~1), (lx,ly) = 돌지 않는 좌표 (빛 방향용) */
const BALLS: Partial<Record<ItemKind, { shade: Shader; edge: string }>> = {
  marble: {
    edge: '#1d5c66',
    shade: (u, v, d, lx, ly) => {
      if (lx < -0.2 && ly < -0.2 && lx + ly < -0.75) return '#ffffff'
      if (Math.abs(u * 0.7 + v - 0.1) < 0.28) return '#ff8fb0'
      return d < 0.6 ? '#7fe3e8' : '#3fb5c4'
    }
  },
  steel: {
    edge: '#3c4248',
    shade: (_u, _v, d, lx, ly) => {
      if (lx < -0.15 && ly < -0.15 && lx + ly < -0.7) return '#ffffff'
      const t = lx + ly
      return t < -0.3 ? '#d7dee5' : t < 0.5 ? '#a9b6c2' : '#7b8794'
    }
  },
  pingpong: {
    edge: '#c27a2a',
    shade: (u, v, _d, lx, ly) => {
      if (lx < -0.2 && ly < -0.2 && lx + ly < -0.8) return '#ffffff'
      if (Math.abs(u) < 0.25 && Math.abs(v + 0.1) < 0.2) return '#ff4d4d'
      return lx + ly > 0.6 ? '#ffb15c' : '#ffd08a'
    }
  },
  rubber: {
    edge: '#7a1630',
    shade: (u, _v, _d, lx, ly) => {
      if (lx < -0.2 && ly < -0.2 && lx + ly < -0.8) return '#ffe1e1'
      if (Math.abs(u) < 0.22) return '#ffd23f'
      return lx + ly > 0.5 ? '#d6304f' : '#ff4d6a'
    }
  },
  bowling: {
    edge: '#0b0a1f',
    shade: (u, v, _d, lx, ly) => {
      if (lx < -0.25 && ly < -0.25 && lx + ly < -0.85) return '#8f8cff'
      for (const [hx, hy] of [
        [-0.25, -0.35],
        [0.1, -0.45],
        [-0.05, -0.05]
      ]) {
        if (Math.hypot(u - hx, v - hy) < 0.13) return '#0b0a1f'
      }
      return lx + ly > 0.4 ? '#2a2470' : '#3d36a8'
    }
  },
  watermelon: {
    edge: '#123d12',
    shade: (u, v, _d, lx, ly) => {
      if (lx < -0.2 && ly < -0.2 && lx + ly < -0.8) return '#b8f0a0'
      const stripe = Math.sin(u * 9 + Math.sin(v * 4) * 1.2)
      return stripe > 0.35 ? '#1f6b1f' : '#5fb84a'
    }
  },
  bomb: {
    edge: '#000000',
    shade: (_u, _v, _d, lx, ly) => {
      if (lx < -0.2 && ly < -0.2 && lx + ly < -0.75) return '#8a8a8a'
      return '#2b2b30'
    }
  },
  chunk: {
    edge: '#1f6b1f',
    shade: (_u, v) => (v > 0.35 ? '#5fb84a' : v > 0.1 ? '#f4f4d4' : '#ff4d5e')
  }
}

export function itemSprite(kind: ItemKind, angle: number, dot: number, blink = false): Sprite {
  const def = ITEMS[kind]
  const steps = def.shape === 'stick' ? 48 : 24
  const b = bucket(angle, steps)
  return cached(`i:${kind}:${b}:${dot}:${blink ? 1 : 0}`, () => {
    const a = (b / steps) * Math.PI * 2
    const ca = Math.cos(-a)
    const sa = Math.sin(-a)
    if (def.shape === 'stick') return stickSprite(kind, a, dot)
    const r = def.r
    const look = BALLS[kind]!
    const extra = kind === 'bomb' ? 8 : 0
    const n = Math.ceil(((r + extra) * 2) / dot) + 2
    return raster(
      n,
      dot,
      (x, y) => {
        // 폭탄 심지 (같이 돈다)
        if (kind === 'bomb') {
          const u = (x * ca - y * sa) / r
          const v = (x * sa + y * ca) / r
          if (Math.abs(u - 0.15) < 0.22 && v < -0.85 && v > -1.25) return '#8a6a3c'
          if (Math.abs(u - 0.3) < 0.25 && v <= -1.25 && v > -1.65) return blink ? '#fff6a0' : '#ff9a3c'
        }
        const d = Math.hypot(x, y) / r
        if (d > 1) return null
        const u = (x * ca - y * sa) / r
        const v = (x * sa + y * ca) / r
        return look.shade(u, v, d, x / r, y / r)
      },
      shadeEdge(look.edge)
    )
  })
}

function stickSprite(kind: ItemKind, a: number, dot: number): Sprite {
  const def = ITEMS[kind]
  const L = def.r
  const n = Math.ceil((L * 2 + 6) / dot) + 2
  const ca = Math.cos(-a)
  const sa = Math.sin(-a)
  const head = kind === 'arrow' ? 8 : 6
  return raster(n, dot, (x, y) => {
    const u = x * ca - y * sa // 앞(촉) 쪽 +
    const w = Math.abs(x * sa + y * ca)
    const half = dot * 0.9
    if (u > L - head && u <= L + 1) {
      // 촉: 끝으로 갈수록 가늘게
      const t = (L + 1 - u) / head
      if (w <= Math.max(half, t * (kind === 'arrow' ? 4.5 : 3))) return '#c9d3dc'
      return null
    }
    if (u < -L + (kind === 'arrow' ? 9 : 5) && u > -L - 1) {
      // 깃
      if (w <= (kind === 'arrow' ? 4 : 3)) return kind === 'arrow' ? '#ff4d4d' : '#ffd23f'
      return null
    }
    if (u >= -L && u <= L - head && w <= half) return kind === 'arrow' ? '#9a6a3c' : '#3c4248'
    return null
  })
}

// ───────── 구조물 ─────────

function inPart(p: Part, s: number, x: number, y: number, pad = 0): boolean {
  if (p.t === 'ball') return Math.hypot(x - p.x * s, y - p.y * s) <= p.r * s + pad
  const a = -(p.a ?? 0)
  const dx = x - p.x * s
  const dy = y - p.y * s
  const u = dx * Math.cos(a) - dy * Math.sin(a)
  const v = dx * Math.sin(a) + dy * Math.cos(a)
  return Math.abs(u) <= p.hw * s + pad && Math.abs(v) <= p.hh * s + pad
}

function partsRadius(parts: Part[], s: number): number {
  let r = 8
  for (const p of parts) r = Math.max(r, p.t === 'box' ? Math.hypot(Math.abs(p.x) + p.hw, Math.abs(p.y) + p.hh) * s : (Math.hypot(p.x, p.y) + p.r) * s)
  return r
}

/** 구조물 고정 부분 (+ 장식) */
export function structSprite(kind: StructureKind, a: number, s: number, dot: number, t = 0): Sprite {
  const def = STRUCTURES[kind]
  const anim = kind === 'conveyor' ? Math.floor(t * 8) % 4 : 0
  return cached(`s:${kind}:${a.toFixed(3)}:${s}:${dot}:${anim}`, () => {
    const R = partsRadius(def.parts, s) + (kind === 'hoop' ? 30 * s : kind === 'spring' ? 6 : kind === 'bell' ? 8 * s : 0)
    const n = Math.ceil((R * 2) / dot) + 2
    const ca = Math.cos(-a)
    const sa = Math.sin(-a)
    return raster(
      n,
      dot,
      (x, y) => {
        const lx = x * ca - y * sa
        const ly = x * sa + y * ca
        const deco = decorate(kind, lx / s, ly / s, anim)
        if (deco !== undefined) return deco
        for (const p of def.parts) if (inPart(p, s, lx, ly)) return MATERIALS[p.mat ?? def.mat].color
        return null
      },
      (col) => edgeOf(col)
    )
  })
}

/** 따로 움직이는 부분 (시소 판·풍차 날개) */
export function movingSprite(kind: StructureKind, a: number, s: number, dot: number): Sprite {
  const def = STRUCTURES[kind]
  const mv = def.moving!
  const b = bucket(a, 72)
  return cached(`m:${kind}:${b}:${s}:${dot}`, () => {
    const aa = (b / 72) * Math.PI * 2
    const n = Math.ceil((partsRadius(mv.parts, s) * 2) / dot) + 2
    const ca = Math.cos(-aa)
    const sa = Math.sin(-aa)
    return raster(
      n,
      dot,
      (x, y) => {
        const lx = x * ca - y * sa
        const ly = x * sa + y * ca
        for (const p of mv.parts) if (inPart(p, s, lx, ly)) return kind === 'windmill' && Math.abs(lx) + Math.abs(ly) > 34 * s ? '#ffffff' : MATERIALS[def.mat].color
        return null
      },
      (col) => edgeOf(col)
    )
  })
}

const EDGES = new Map<string, string>(Object.values(MATERIALS).map((m) => [m.color, m.edge]))
EDGES.set('#ffffff', '#7b8794')
EDGES.set('#f4f0e6', '#8a8070')
EDGES.set('#ff4d4d', '#8c1f1f')
EDGES.set('#ffd23f', '#9a6a00')
function edgeOf(col: string): string {
  return EDGES.get(col) ?? '#141414'
}

/** 구조물별 장식. undefined = 장식 없음(기본 모양), null = 비움 */
function decorate(kind: StructureKind, x: number, y: number, anim: number): Color | undefined {
  switch (kind) {
    case 'cup':
      // 하얀 머그잔 + 손잡이
      if (x > 33 && x < 47 && y > -16 && y < 16 && !(x > 33 && x < 41 && y > -9 && y < 9)) return '#f4f0e6'
      if (Math.abs(x) <= 34 && y >= -34 && y <= 36 && (Math.abs(x) >= 22 || y >= 24)) return y > -26 && y < -20 ? '#ff4d4d' : '#f4f0e6'
      return undefined
    case 'bucket':
      if (y > -6 && y < -1 && Math.abs(x) < 46 && Math.abs(x) > 34) return '#ffd23f'
      return undefined
    case 'hoop':
      // 그물: 고리 아래로 줄무늬
      if (y > 3 && y < 26 && x > -22 + (y - 3) * 0.35 && x < 24 - (y - 3) * 0.35 && (Math.round(x + y) % 6 === 0 || Math.round(x - y) % 6 === 0)) return '#ffffff'
      if (Math.abs(y) <= 2 && x >= -26 && x <= 31) return '#ff4d4d'
      return undefined
    case 'bumper': {
      const d = Math.hypot(x, y)
      if (d <= 18 && d > 12) return '#ff5c8a'
      if (d <= 12 && d > 9) return '#ffffff'
      if (d <= 9) return '#ffd23f'
      return undefined
    }
    case 'spring':
      if (y > -1 && y < 6 && Math.abs(x) < 16) return Math.round(x / 3 + y) % 2 ? '#a9b6c2' : null
      return undefined
    case 'bell': {
      // 종 모양 (아래가 넓은 사다리꼴)
      const half = 7 + (y + 14) * 0.45
      if (y >= -16 && y <= 12 && Math.abs(x) <= half) return y > 8 ? '#c99a1c' : '#ffd23f'
      if (Math.hypot(x, y - 15) < 3.5) return '#9a6a00'
      return null
    }
    case 'seesaw':
      // 받침 삼각형
      if (y >= 4 && y <= 24 && Math.abs(x) <= (y - 4) * 0.6 + 1) return '#8c5a2b'
      return null
    case 'windmill':
      return Math.hypot(x, y) <= 7 ? '#a9b6c2' : null
    case 'conveyor':
      if (Math.abs(y) <= 7 && Math.abs(x) <= 70) {
        if (Math.abs(y) >= 5) return '#3c4248'
        return Math.floor((x + 70 + anim * 3) / 6) % 2 ? '#ff5c8a' : '#d6304f'
      }
      return undefined
  }
  return undefined
}

// ───────── 웜홀 ─────────

export function portalColors(c: number): [string, string] {
  return PORTAL_COLORS[c % PORTAL_COLORS.length]
}

/** 소용돌이 고리. phase 0~1 로 돌아간다. 짝 없으면 흐리게 깜빡 */
export function portalSprite(c: number, R: number, dot: number, frame: number, dir: 1 | -1, pending: boolean): Sprite {
  return cached(`p:${c}:${R}:${dot}:${frame}:${dir}:${pending ? 1 : 0}`, () => {
    const [ca, cb] = portalColors(c)
    const n = Math.ceil((R * 2 + 8) / dot) + 2
    const ph = (frame / 12) * Math.PI * 2 * dir
    return raster(n, dot, (x, y) => {
      const d = Math.hypot(x, y)
      if (d > R + 3) return null
      const t = Math.atan2(y, x)
      if (d > R - 4) {
        if (pending) return Math.floor(((t + Math.PI) / (Math.PI * 2)) * 16 + frame) % 2 ? ca : null
        return Math.sin(t * 3 + ph) > 0 ? ca : cb
      }
      if (pending) return d < R * 0.35 ? '#1b1236' : null
      // 안쪽 소용돌이
      const arm = Math.sin(t * 2 - d * 0.22 + ph * 1.5)
      if (d < R * 0.28) return '#06040e'
      if (arm > 0.55) return d < R * 0.6 ? '#ffffff' : ca
      if (arm < -0.6) return cb
      return '#140d2a'
    })
  })
}

// ───────── 공구함 아이콘 ─────────

export function iconFor(kind: string, dot: number): Sprite {
  if (kind in ITEMS) {
    const k = kind as ItemKind
    return itemSprite(k, ITEMS[k].shape === 'stick' ? -Math.PI / 4 : 0, dot)
  }
  if (kind in STRUCTURES) {
    const k = kind as StructureKind
    const s = k === 'plank' || k === 'conveyor' || k === 'seesaw' ? 0.32 : k === 'pegs' || k === 'windmill' || k === 'bucket' || k === 'funnel' ? 0.42 : k === 'hoop' ? 0.45 : 0.6
    if (k === 'windmill') {
      return cached(`icon:${k}:${dot}`, () => {
        const a = movingSprite(k, Math.PI / 4, s, dot)
        return a
      })
    }
    if (k === 'seesaw') {
      return cached(`icon:${k}:${dot}`, () => {
        const base = structSprite(k, 0, s, dot)
        const plank = movingSprite(k, -0.25, s, dot)
        const n = Math.max(base.c, plank.c) * 2 + 1
        const cv = document.createElement('canvas')
        cv.width = cv.height = n * dot
        const g = cv.getContext('2d')!
        const c = (n - 1) / 2
        g.drawImage(base.canvas, (c - base.c) * dot, (c - base.c) * dot)
        g.drawImage(plank.canvas, (c - plank.c) * dot, (c - plank.c) * dot)
        return { canvas: cv, c, dot }
      })
    }
    return structSprite(k, 0, s, dot)
  }
  return raster(5, dot, () => '#ffffff')
}

export function materialSwatch(mat: Material, dot: number): Sprite {
  return cached(`mat:${mat}:${dot}`, () => {
    const md = MATERIALS[mat]
    return raster(11, dot, (x, y) => {
      // 물결 모양 선
      const yy = Math.sin(x / (dot * 2)) * dot * 1.5
      return Math.abs(y - yy) <= dot * 1.2 ? md.color : null
    }, () => md.edge)
  })
}
