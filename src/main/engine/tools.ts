// 도구: 메인이 읽은 커서·버튼으로 세계를 고친다 (놓기·그리기·새총·손·지우개).
// 왼쪽 = 도구 쓰기, 오른쪽 = 그 자리 것 지우기.
import { ITEMS, PORTAL_R, STRUCTURES, type ItemKind } from '@shared/defs'
import type { PreviewMode, Tool, ToolView } from '@shared/types'
import { distToSeg, type World } from './world'

/** 새총: 이만큼 당기면 최대 힘 */
const PULL_MAX = 220
/** 이보다 덜 움직이면 클릭(그 자리에 놓기) */
const CLICK_SLOP = 7
const SNAP = Math.PI / 12 // 15°

type Undo = { t: 'item' | 'struct' | 'stroke' | 'portal'; id: number }

type Drag =
  | { t: 'none' }
  | { t: 'item-aim'; x: number; y: number; moved: boolean }
  | { t: 'grab'; id: number }
  | { t: 'move-struct'; id: number; dx: number; dy: number; moved: boolean }
  | { t: 'rotate-struct'; id: number }
  | { t: 'move-portal'; id: number; dx: number; dy: number }
  | { t: 'rotate-portal'; id: number }
  | { t: 'place-struct'; id: number; x: number; y: number }
  | { t: 'place-portal'; id: number; x: number; y: number }
  | { t: 'draw'; pts: number[] }
  | { t: 'erase' }

export interface Launch {
  kind: ItemKind
  x: number
  y: number
  vx: number
  vy: number
}

export class Tools {
  tool: Tool = { t: 'none' }
  private drag: Drag = { t: 'none' }
  private was = { left: false, right: false }
  private cursor = { x: 0, y: 0 }
  private undoStack: Undo[] = []
  sel: { t: 'struct' | 'portal'; id: number } | null = null
  lastLaunch: Launch | null = null
  /** 바뀌면 공구함에 다시 알린다 */
  changed = false

  constructor(
    private world: World,
    private preview: () => PreviewMode
  ) {}

  setTool(t: Tool): void {
    this.cancel()
    this.tool = t
    if (t.t !== 'hand') this.sel = null
    this.changed = true
  }

  /** 하던 것을 그만둔다 (그리는 선은 버림) */
  cancel(): void {
    if (this.drag.t === 'grab') this.world.release()
    this.drag = { t: 'none' }
  }

  private push(u: Undo): void {
    this.undoStack.push(u)
    if (this.undoStack.length > 200) this.undoStack.shift()
    this.changed = true
  }

  undo(): void {
    this.cancel()
    const u = this.undoStack.pop()
    if (!u) return
    if (u.t === 'item') this.world.removeItem(u.id)
    else if (u.t === 'struct') this.world.removeStructure(u.id)
    else if (u.t === 'stroke') this.world.removeStroke(u.id)
    else this.world.removePortal(u.id)
    if (this.sel?.id === u.id) this.sel = null
    this.changed = true
  }

  relaunch(): void {
    const l = this.lastLaunch
    if (!l) return
    this.push({ t: 'item', id: this.world.spawnItem(l.kind, l.x, l.y, l.vx, l.vy, true) })
  }

  /** 휠: 고른(없으면 올라간) 구조물·웜홀을 15° 돌린다 */
  wheel(dy: number): void {
    const target = this.sel ?? this.hoverTarget()
    if (!target || dy === 0) return
    const step = dy > 0 ? SNAP : -SNAP
    if (target.t === 'struct') {
      const st = this.world.structure(target.id)
      if (st) this.world.moveStructure(target.id, st.x, st.y, snap(st.a + step))
    } else {
      const p = this.world.portals.get(target.id)
      if (p) p.a = snap(p.a + step)
    }
  }

  private hoverTarget(): { t: 'struct' | 'portal'; id: number } | null {
    const { x, y } = this.cursor
    const p = this.world.portalAt(x, y)
    if (p) return { t: 'portal', id: p.id }
    const s = this.world.structureAt(x, y)
    return s !== null ? { t: 'struct', id: s } : null
  }

  /** 고른 것의 회전 손잡이 위치 */
  private handle(): { x: number; y: number } | null {
    if (!this.sel) return null
    if (this.sel.t === 'portal') {
      const p = this.world.portals.get(this.sel.id)
      if (!p) return null
      return { x: p.x + Math.cos(p.a) * (PORTAL_R + 16), y: p.y + Math.sin(p.a) * (PORTAL_R + 16) }
    }
    const st = this.world.structure(this.sel.id)
    if (!st) return null
    const r = structRadius(st.kind) * st.s + 16
    return { x: st.x + Math.cos(st.a) * r, y: st.y + Math.sin(st.a) * r }
  }

  update(x: number, y: number, left: boolean, right: boolean): void {
    this.cursor = { x, y }
    if (this.tool.t === 'none') {
      this.was = { left, right }
      return
    }
    const pressL = left && !this.was.left
    const releaseL = !left && this.was.left
    const pressR = right && !this.was.right
    this.was = { left, right }

    if (pressR && this.drag.t === 'none') this.eraseAt(x, y, 10)

    if (pressL) this.begin(x, y)
    else if (left) this.move(x, y)
    if (releaseL) this.end(x, y)
  }

  private begin(x: number, y: number): void {
    const t = this.tool
    switch (t.t) {
      case 'item':
        this.drag = { t: 'item-aim', x, y, moved: false }
        break
      case 'draw':
        this.drag = { t: 'draw', pts: [x, y] }
        break
      case 'erase':
        this.drag = { t: 'erase' }
        this.eraseAt(x, y, 12)
        break
      case 'portal': {
        const p = this.world.portalAt(x, y)
        if (p) this.drag = { t: 'move-portal', id: p.id, dx: p.x - x, dy: p.y - y }
        else {
          const id = this.world.addPortal(x, y, 0)
          this.push({ t: 'portal', id })
          this.drag = { t: 'place-portal', id, x, y }
        }
        break
      }
      case 'struct': {
        const id = this.world.addStructure(t.kind, x, y, 0)
        this.push({ t: 'struct', id })
        this.drag = { t: 'place-struct', id, x, y }
        break
      }
      case 'hand': {
        const h = this.handle()
        if (h && this.sel && Math.hypot(h.x - x, h.y - y) < 12) {
          this.drag = this.sel.t === 'struct' ? { t: 'rotate-struct', id: this.sel.id } : { t: 'rotate-portal', id: this.sel.id }
          break
        }
        const item = this.world.itemAt(x, y, 8)
        if (item !== null) {
          this.world.grabItem(item, x, y)
          this.drag = { t: 'grab', id: item }
          break
        }
        const p = this.world.portalAt(x, y)
        if (p) {
          this.sel = { t: 'portal', id: p.id }
          this.drag = { t: 'move-portal', id: p.id, dx: p.x - x, dy: p.y - y }
          this.changed = true
          break
        }
        const s = this.world.structureAt(x, y)
        if (s !== null) {
          const st = this.world.structure(s)!
          this.sel = { t: 'struct', id: s }
          this.drag = { t: 'move-struct', id: s, dx: st.x - x, dy: st.y - y, moved: false }
          this.changed = true
          break
        }
        if (this.sel) {
          this.sel = null
          this.changed = true
        }
        break
      }
    }
  }

  private move(x: number, y: number): void {
    const d = this.drag
    switch (d.t) {
      case 'item-aim':
        if (Math.hypot(x - d.x, y - d.y) > CLICK_SLOP) d.moved = true
        break
      case 'draw': {
        const n = d.pts.length
        if (Math.hypot(x - d.pts[n - 2], y - d.pts[n - 1]) >= 4) d.pts.push(x, y)
        break
      }
      case 'erase':
        this.eraseAt(x, y, 12)
        break
      case 'grab':
        this.world.dragTo(x, y)
        break
      case 'move-portal': {
        const p = this.world.portals.get(d.id)
        if (p) {
          p.x = x + d.dx
          p.y = y + d.dy
        }
        break
      }
      case 'rotate-portal':
      case 'place-portal': {
        const p = this.world.portals.get(d.id)
        if (!p) break
        if (d.t === 'place-portal' && Math.hypot(x - d.x, y - d.y) < 12) break
        p.a = snap(Math.atan2(y - p.y, x - p.x))
        break
      }
      case 'move-struct': {
        const st = this.world.structure(d.id)
        if (!st) break
        const nx = x + d.dx
        const ny = y + d.dy
        if (Math.hypot(nx - st.x, ny - st.y) >= 1) {
          d.moved = true
          this.world.moveStructure(d.id, nx, ny)
        }
        break
      }
      case 'rotate-struct':
      case 'place-struct': {
        const st = this.world.structure(d.id)
        if (!st) break
        if (d.t === 'place-struct' && Math.hypot(x - d.x, y - d.y) < 12) break
        const a = snap(Math.atan2(y - st.y, x - st.x))
        if (a !== st.a) this.world.moveStructure(d.id, st.x, st.y, a)
        break
      }
    }
  }

  private end(x: number, y: number): void {
    const d = this.drag
    this.drag = { t: 'none' }
    switch (d.t) {
      case 'item-aim': {
        if (this.tool.t !== 'item') break
        const kind = this.tool.kind
        if (!d.moved) {
          this.push({ t: 'item', id: this.world.spawnItem(kind, d.x, d.y, 0, 0, true) })
          break
        }
        const v = this.launchVelocity(kind, d.x, d.y, x, y)
        this.lastLaunch = { kind, x: d.x, y: d.y, vx: v.vx, vy: v.vy }
        this.push({ t: 'item', id: this.world.spawnItem(kind, d.x, d.y, v.vx, v.vy, true) })
        break
      }
      case 'draw': {
        if (this.tool.t !== 'draw') break
        const pts = simplify(d.pts, 1.5)
        if (pts.length >= 4) {
          const id = this.world.addStroke(this.tool.mat, pts)
          if (id !== null) this.push({ t: 'stroke', id })
        } else {
          // 짧게 누르기만 하면 점 하나 (작은 받침)
          const id = this.world.addStroke(this.tool.mat, [x - 4, y, x + 4, y])
          if (id !== null) this.push({ t: 'stroke', id })
        }
        break
      }
      case 'grab':
        this.world.release()
        break
      case 'place-portal':
        if (this.tool.t === 'portal') this.changed = true
        break
    }
  }

  private launchVelocity(kind: ItemKind, ax: number, ay: number, x: number, y: number): { vx: number; vy: number; power: number } {
    let dx = ax - x
    let dy = ay - y
    const l = Math.hypot(dx, dy)
    const power = Math.min(1, l / PULL_MAX)
    if (l > 0) {
      dx /= l
      dy /= l
    }
    // 약하게 당기면 더 약하게 (끝으로 갈수록 세짐)
    const sp = ITEMS[kind].launch * (0.15 + 0.85 * power)
    return { vx: dx * sp, vy: dy * sp, power }
  }

  private eraseAt(x: number, y: number, r: number): void {
    const item = this.world.itemAt(x, y, r)
    if (item !== null) return this.world.removeItem(item)
    const p = this.world.portalAt(x, y)
    if (p) {
      if (this.sel?.id === p.id || this.sel?.id === p.pair) this.sel = null
      this.changed = true
      return this.world.removePortal(p.id)
    }
    const stroke = this.world.strokeAt(x, y, r)
    if (stroke !== null) {
      this.changed = true
      return this.world.removeStroke(stroke)
    }
    const s = this.world.structureAt(x, y, 4)
    if (s !== null) {
      if (this.sel?.id === s) this.sel = null
      this.changed = true
      this.world.removeStructure(s)
    }
  }

  deleteSelected(): void {
    if (!this.sel) return
    if (this.sel.t === 'struct') this.world.removeStructure(this.sel.id)
    else this.world.removePortal(this.sel.id)
    this.sel = null
    this.changed = true
  }

  scaleSelected(dir: 1 | -1): void {
    if (this.sel?.t !== 'struct') return
    const st = this.world.structure(this.sel.id)
    if (!st) return
    const sizes = [0.6, 0.8, 1, 1.3, 1.7]
    const i = sizes.findIndex((s) => Math.abs(s - st.s) < 0.01)
    const n = sizes[Math.max(0, Math.min(sizes.length - 1, (i < 0 ? 2 : i) + dir))]
    this.world.moveStructure(this.sel.id, st.x, st.y, st.a, n)
    this.changed = true
  }

  view(): ToolView | null {
    if (this.tool.t === 'none') return null
    const { x, y } = this.cursor
    const d = this.drag
    let aim: ToolView['aim'] = null
    if (d.t === 'item-aim' && d.moved && this.tool.t === 'item') {
      const v = this.launchVelocity(this.tool.kind, d.x, d.y, x, y)
      const mode = this.preview()
      const pts = mode === 'off' ? [] : this.world.predict(this.tool.kind, d.x, d.y, v.vx, v.vy, mode === 'full' ? 3 : 0, mode === 'full' ? 2.4 : 0.35)
      aim = { x: d.x, y: d.y, power: v.power, pts }
    }
    let hover: ToolView['hover'] = null
    if (this.tool.t === 'hand' || this.tool.t === 'erase') {
      const item = this.world.itemAt(x, y, 8)
      const p = item === null ? this.world.portalAt(x, y) : null
      const stroke = item === null && !p && this.tool.t === 'erase' ? this.world.strokeAt(x, y, 12) : null
      const s = item === null && !p && stroke === null ? this.world.structureAt(x, y, this.tool.t === 'erase' ? 4 : 6) : null
      hover = item !== null ? { t: 'item', id: item } : p ? { t: 'portal', id: p.id } : stroke !== null ? { t: 'stroke', id: stroke } : s !== null ? { t: 'struct', id: s } : null
    }
    const h = this.tool.t === 'hand' ? this.handle() : null
    return {
      tool: this.tool,
      cursor: { x, y },
      aim,
      stroke: d.t === 'draw' ? d.pts : null,
      hover,
      sel: this.sel && h ? { ...this.sel, hx: h.x, hy: h.y } : null,
      pending: [...this.world.portals.values()].some((p) => p.pair === null),
      erase: this.tool.t === 'erase' ? 12 : 0
    }
  }
}

function snap(a: number): number {
  const s = Math.round(a / SNAP) * SNAP
  // -π ~ π
  return Math.atan2(Math.sin(s), Math.cos(s))
}

/** 구조물의 대략 반지름 (회전 손잡이 자리) */
export function structRadius(kind: keyof typeof STRUCTURES): number {
  const def = STRUCTURES[kind]
  let r = 10
  for (const p of [...def.parts, ...(def.moving?.parts ?? [])]) {
    r = Math.max(r, p.t === 'box' ? Math.hypot(Math.abs(p.x) + p.hw, Math.abs(p.y) + p.hh) : Math.hypot(p.x, p.y) + p.r)
  }
  return r
}

/** 선 단순화 (Ramer–Douglas–Peucker) */
export function simplify(pts: number[], eps: number): number[] {
  const n = pts.length / 2
  if (n <= 2) return pts.slice()
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack: [number, number][] = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let best = -1
    let bd = eps
    for (let i = a + 1; i < b; i++) {
      const d = distToSeg(pts[i * 2], pts[i * 2 + 1], pts[a * 2], pts[a * 2 + 1], pts[b * 2], pts[b * 2 + 1])
      if (d > bd) {
        bd = d
        best = i
      }
    }
    if (best >= 0) {
      keep[best] = 1
      stack.push([a, best], [best, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
  return out
}
