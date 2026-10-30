// 물리 세계: 모든 화면을 하나의 좌표(화면 좌표 DIP)로 묶어 Rapier 로 계산한다.
// - 장난감(구슬·화살…): 움직이는 몸체
// - 구조물·그린 선·바닥/벽: 고정 몸체 (시소 판·풍차 날개만 따로 움직임)
// - 다른 앱 창: 무중력 + 큰 감쇠의 움직이는 상자. 맞으면 밀리고, 무거운 게 올라앉으면 조금씩 내려간다.
//   여기서 계산한 위치를 메인이 실제 창에 옮겨 준다 (windows/move.ts)
// - 웜홀: 몸체 없음. 매 단계 뒤에 중심이 웜홀 원에 들어간 장난감을 짝 웜홀로 옮긴다
import RAPIER, { type Collider, type RigidBody } from '@dimforge/rapier2d-deterministic-compat'
import { ITEMS, MATERIALS, PORTAL_R, STRUCTURES, type ItemKind, type Material, type Part, type StructureKind } from '@shared/defs'
import type { Fx, Frame, PortalView, Rect, StructView, StrokeView } from '@shared/types'

/** 1m = 100px. Rapier 는 미터 단위 크기(0.1~10)에서 가장 안정적이다 */
const PX = 100
const m = (px: number): number => px / PX
const px = (v: number): number => v * PX
export const DT = 1 / 120
const GRAVITY = 28 // m/s² — 실제보다 세게: 화면 높이를 1초 안쪽에 떨어져야 손맛이 난다

// 충돌 묶음: (속한 묶음 << 16) | 부딪히는 묶음
const G_ITEM = 1
const G_WINDOW = 2
const G_STATIC = 4
const G_WINWALL = 8
const groups = (member: number, filter: number): number => (member << 16) | filter

const MAX_ITEMS = 400
/** 최고 속도 (웜홀 무한 낙하가 끝없이 빨라지지 않게) ≈ 990 km/h */
const MAX_SPEED = m(27500)
/** 창: 넓이당 밀도 · 감쇠 · 이보다 느리면 멈춤(정지 마찰 흉내) */
const WIN_DENSITY = 1.2
const WIN_DAMPING = 4
const WIN_STICK = 0.05 // m/s = 5px/s
/** 창이 버티는 힘(마찰) — 가속도로. 구슬 몇 개쯤은 버티고, 볼링공 하나부터 슬금슬금 내려간다 */
const WIN_FRICTION = 1.6 // m/s²
const WIN_MAX_SPEED = 30 // m/s

type Owner =
  | { t: 'item'; id: number }
  | { t: 'struct'; id: number; mat: Material }
  | { t: 'stroke'; id: number; mat: Material }
  | { t: 'window'; id: number }
  | { t: 'wall' }

interface Stuck {
  /** 박힌 대상 몸체 (창·구조물·선). 대상이 없어지면 다시 떨어진다 */
  target: RigidBody
  windowId: number | null
  lx: number
  ly: number
  la: number
  collider: Collider
}

interface Item {
  id: number
  kind: ItemKind
  body: RigidBody | null
  collider: Collider | null
  born: number
  bounces: number
  portals: number
  /** 이 창들과는 부딪히지 않는다 (창 안쪽에서 생겼을 때 — 완전히 빠져나오면 지움) */
  ghost: Set<number>
  /** 이 웜홀에서 막 나왔다 — 원 밖으로 나갈 때까지 다시 빨려들지 않는다 */
  cool: Set<number>
  prev: { x: number; y: number }
  speed: number
  stuck: Stuck | null
  fuse: number
  goalTime: Map<number, number>
  scored: Set<number>
  touching: Map<number, Owner>
  held: boolean
  outside: number
}

interface Structure {
  id: number
  kind: StructureKind
  x: number
  y: number
  a: number
  s: number
  pinned: boolean
  body: RigidBody
  moving: RigidBody | null
  colliders: Collider[]
}

interface Stroke {
  id: number
  mat: Material
  pts: number[]
  body: RigidBody
}

export interface Portal {
  id: number
  pair: number | null
  x: number
  y: number
  a: number
  color: number
}

export interface WinInfo {
  id: number
  pid: number
  x: number
  y: number
  w: number
  h: number
}

interface Win {
  id: number
  pid: number
  w: number
  h: number
  body: RigidBody
  collider: Collider
  /** dyn: 물리로 움직임 · user: 사용자가 끄는 중(따라감) · fixed: 옮길 수 없음(따라만 감) */
  mode: 'dyn' | 'user' | 'fixed'
  /** 마지막으로 실제 창에 보낸 위치(왼쪽 위) */
  sent: { x: number; y: number } | null
  sentAt: number
  /** 처음 건드리기 전 위치 — 원위치용 */
  orig: { x: number; y: number } | null
  /** 사용자가 끄는 동안 마지막으로 위치가 바뀐 때 */
  userAt: number
  os: { x: number; y: number }
  failUntil: number
  /** 화면 가장자리 벽과 부딪히나 — 처음부터 화면 밖에 걸친 창은 다 들어올 때까지 벽을 무시 (튕겨 나가지 않게) */
  walled: boolean
}

export interface Display {
  bounds: Rect
  work: Rect
}

export interface Move {
  id: number
  pid: number
  x: number
  y: number
  /** 지금 실제 창 자리 (창을 찾을 때 씀) */
  from: { x: number; y: number; w: number; h: number }
}

let rapierReady: Promise<void> | null = null
export function initPhysics(): Promise<void> {
  rapierReady ??= RAPIER.init()
  return rapierReady
}

export class World {
  readonly w: RAPIER.World
  private events = new RAPIER.EventQueue(true)
  private owners = new Map<number, Owner>()
  private items = new Map<number, Item>()
  private structs = new Map<number, Structure>()
  private strokes = new Map<number, Stroke>()
  readonly portals = new Map<number, Portal>()
  private wins = new Map<number, Win>()
  private walls: RigidBody | null = null
  private displays: Display[] = []
  private nextId = 1
  private nextColor = 0
  private fx: Fx[] = []
  time = 0
  /** 마지막 골인 뒤로 몇 번 던졌나 */
  attempts = 0
  /** 손 도구로 잡은 장난감과 목표 위치 */
  private grab: { id: number; x: number; y: number } | null = null
  /** 창을 옮길 수 있나 (권한) */
  canMoveWindows = false
  strokesVersion = 0
  /** 화면에 뭔가 있나 (없으면 루프를 멈추고 오버레이를 숨긴다) */
  get empty(): boolean {
    return this.items.size === 0 && this.structs.size === 0 && this.strokes.size === 0 && this.portals.size === 0
  }
  /** 움직이는 게 없나 (장난감이 다 잠들었고 창도 멈춤) — 루프를 느리게 돌려도 된다 */
  get idle(): boolean {
    if (this.grab) return false
    for (const it of this.items.values()) if (it.body && !it.body.isSleeping()) return false
    for (const st of this.structs.values()) if (st.moving && STRUCTURES[st.kind].moving?.mode === 'spin') return false
    for (const w of this.wins.values()) {
      if (w.mode === 'user') return false
      if (w.mode === 'dyn') {
        const v = w.body.linvel()
        if (v.x !== 0 || v.y !== 0) return false
      }
    }
    return true
  }

  get itemCount(): number {
    return this.items.size
  }

  private hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (c1, c2) => {
      const a = this.owners.get(c1)
      const b = this.owners.get(c2)
      if (a?.t === 'item' && b?.t === 'window' && this.items.get(a.id)?.ghost.has(b.id)) return RAPIER.SolverFlags.EMPTY
      if (b?.t === 'item' && a?.t === 'window' && this.items.get(b.id)?.ghost.has(a.id)) return RAPIER.SolverFlags.EMPTY
      return RAPIER.SolverFlags.COMPUTE_IMPULSE
    },
    filterIntersectionPair: () => true
  }

  constructor() {
    this.w = new RAPIER.World({ x: 0, y: GRAVITY })
    this.w.timestep = DT
  }

  private id(): number {
    return this.nextId++
  }

  private own(c: Collider, o: Owner): Collider {
    this.owners.set(c.handle, o)
    return c
  }

  private drop(c: Collider | null): void {
    if (!c) return
    this.owners.delete(c.handle)
  }

  private removeBody(b: RigidBody | null): void {
    if (!b) return
    for (let i = 0; i < b.numColliders(); i++) this.drop(b.collider(i))
    this.w.removeRigidBody(b)
  }

  // ───────── 화면 (바닥·벽) ─────────

  setDisplays(ds: Display[]): void {
    this.displays = ds
    if (this.walls) this.removeBody(this.walls)
    const body = this.w.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    this.walls = body
    const T = 40 // 벽 두께 px
    const touches = (a: Rect, b: Rect, side: 'l' | 'r' | 'b' | 't'): boolean => {
      const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0
      const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0
      if (side === 'l') return overlapY && Math.abs(b.x + b.w - a.x) < 2
      if (side === 'r') return overlapY && Math.abs(a.x + a.w - b.x) < 2
      if (side === 'b') return overlapX && Math.abs(a.y + a.h - b.y) < 2
      return overlapX && Math.abs(b.y + b.h - a.y) < 2
    }
    const box = (x: number, y: number, w: number, h: number, g: number): void => {
      const d = RAPIER.ColliderDesc.cuboid(m(w / 2), m(h / 2))
        .setTranslation(m(x + w / 2), m(y + h / 2))
        .setFriction(0.6)
        .setRestitution(0.3)
        .setCollisionGroups(g)
      this.own(this.w.createCollider(d, body), { t: 'wall' })
    }
    const itemWall = groups(G_STATIC, G_ITEM)
    const winWall = groups(G_WINWALL, G_WINDOW)
    for (const d of ds) {
      const others = ds.filter((o) => o !== d)
      const b = d.bounds
      const wa = d.work
      // 장난감: 작업 영역 바닥(Dock·작업 표시줄 위) + 옆 화면이 없는 쪽 벽
      if (!others.some((o) => touches(b, o.bounds, 'b'))) box(b.x - T, wa.y + wa.h, b.w + 2 * T, T, itemWall)
      if (!others.some((o) => touches(b, o.bounds, 'l'))) box(b.x - T, b.y - 4000, T, b.h + 4000, itemWall)
      if (!others.some((o) => touches(b, o.bounds, 'r'))) box(b.x + b.w, b.y - 4000, T, b.h + 4000, itemWall)
      // 창: 작업 영역 안에만 (메뉴 막대·Dock 을 넘지 않게)
      if (!others.some((o) => touches(b, o.bounds, 'b'))) box(wa.x - T, wa.y + wa.h, wa.w + 2 * T, T, winWall)
      if (!others.some((o) => touches(b, o.bounds, 't'))) box(wa.x - T, wa.y - T, wa.w + 2 * T, T, winWall)
      if (!others.some((o) => touches(b, o.bounds, 'l'))) box(wa.x - T, wa.y, T, wa.h, winWall)
      if (!others.some((o) => touches(b, o.bounds, 'r'))) box(wa.x + wa.w, wa.y, T, wa.h, winWall)
    }
  }

  private onScreen(x: number, y: number, margin = 0): boolean {
    return this.displays.some((d) => x >= d.bounds.x - margin && x <= d.bounds.x + d.bounds.w + margin && y >= d.bounds.y - 3000 && y <= d.bounds.y + d.bounds.h + margin)
  }

  // ───────── 장난감 ─────────

  spawnItem(kind: ItemKind, x: number, y: number, vx = 0, vy = 0, launched = false): number {
    if (this.items.size >= MAX_ITEMS) this.evictOldest()
    const def = ITEMS[kind]
    const id = this.id()
    const angle = def.shape === 'stick' ? Math.atan2(vy, vx || 0.0001) : 0
    const body = this.w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(m(x), m(y))
        .setRotation(angle)
        .setLinvel(m(vx), m(vy))
        .setCcdEnabled(true)
        .setLinearDamping(0.02)
        .setAngularDamping(def.shape === 'stick' ? 4 : 0.3)
    )
    const shape = def.shape === 'ball' ? RAPIER.ColliderDesc.ball(m(def.r)) : RAPIER.ColliderDesc.capsule(m(def.r - (def.thick ?? 2)), m(def.thick ?? 2)).setRotation(Math.PI / 2)
    const collider = this.w.createCollider(
      shape
        .setDensity(def.density)
        .setRestitution(def.restitution)
        .setFriction(def.friction)
        .setCollisionGroups(groups(G_ITEM, G_ITEM | G_WINDOW | G_STATIC))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS),
      body
    )
    this.own(collider, { t: 'item', id })
    const it: Item = {
      id,
      kind,
      body,
      collider,
      born: this.time,
      bounces: 0,
      portals: 0,
      ghost: new Set(),
      cool: new Set(),
      prev: { x, y },
      speed: Math.hypot(vx, vy),
      stuck: null,
      fuse: kind === 'bomb' ? 2.6 : 0,
      goalTime: new Map(),
      scored: new Set(),
      touching: new Map(),
      held: false,
      outside: 0
    }
    // 창 안쪽에서 생기면 그 창과는 부딪히지 않는다 (빠져나오면 다시 부딪힘)
    for (const w of this.wins.values()) if (this.overlapsWin(w, x, y, def.r)) it.ghost.add(w.id)
    // 웜홀 안에서 생기면 바로 빨려들지 않게
    for (const p of this.portals.values()) if (Math.hypot(x - p.x, y - p.y) < PORTAL_R + def.r) it.cool.add(p.id)
    this.items.set(id, it)
    if (launched) this.attempts++
    return id
  }

  private evictOldest(): void {
    let oldest: Item | null = null
    for (const it of this.items.values()) if (!it.held && (!oldest || it.born < oldest.born)) oldest = it
    if (oldest) this.removeItem(oldest.id)
  }

  removeItem(id: number): void {
    const it = this.items.get(id)
    if (!it) return
    if (it.stuck) this.unstick(it, false)
    this.removeBody(it.body)
    this.items.delete(id)
    if (this.grab?.id === id) this.grab = null
  }

  clearItems(): void {
    for (const id of [...this.items.keys()]) this.removeItem(id)
  }

  private itemPos(it: Item): { x: number; y: number; a: number } {
    if (it.stuck) {
      const t = it.stuck.target.translation()
      const r = it.stuck.target.rotation()
      const c = Math.cos(r)
      const s = Math.sin(r)
      return { x: px(t.x) + it.stuck.lx * c - it.stuck.ly * s, y: px(t.y) + it.stuck.lx * s + it.stuck.ly * c, a: r + it.stuck.la }
    }
    const t = it.body!.translation()
    return { x: px(t.x), y: px(t.y), a: it.body!.rotation() }
  }

  private overlapsWin(w: Win, x: number, y: number, r: number): boolean {
    const t = w.body.translation()
    const cx = px(t.x)
    const cy = px(t.y)
    return Math.abs(x - cx) < w.w / 2 + r && Math.abs(y - cy) < w.h / 2 + r
  }

  // ───────── 박히기 (화살·다트) ─────────

  private stick(it: Item, targetCollider: Collider, o: Owner): void {
    if (!it.body || !it.collider) return
    const target = targetCollider.parent()
    if (!target) return
    const def = ITEMS[it.kind]
    const a = it.body.rotation()
    // 화살촉이 조금 파고들게 앞으로 밀어 넣는다
    const t = it.body.translation()
    const x = px(t.x) + Math.cos(a) * 6
    const y = px(t.y) + Math.sin(a) * 6
    const tt = target.translation()
    const tr = target.rotation()
    const c = Math.cos(-tr)
    const s = Math.sin(-tr)
    const dx = x - px(tt.x)
    const dy = y - px(tt.y)
    const lx = dx * c - dy * s
    const ly = dx * s + dy * c
    const la = a - tr
    // 박힌 화살은 대상의 일부가 된다 (그 위에 구슬이 올라앉을 수 있다)
    const col = this.w.createCollider(
      RAPIER.ColliderDesc.capsule(m(def.r - (def.thick ?? 2)), m(def.thick ?? 2))
        .setTranslation(m(lx), m(ly))
        .setRotation(la + Math.PI / 2)
        .setDensity(0.0001)
        .setFriction(0.6)
        .setCollisionGroups(groups(G_STATIC, G_ITEM)),
      target
    )
    this.own(col, { t: 'wall' })
    this.removeBody(it.body)
    it.body = null
    it.collider = null
    it.stuck = { target, windowId: o.t === 'window' ? o.id : null, lx, ly, la, collider: col }
    this.fx.push({ t: 'stick', x, y })
  }

  /** 박힌 대상이 없어지면 다시 떨어뜨린다 */
  private unstick(it: Item, fall: boolean): void {
    const st = it.stuck
    if (!st) return
    const p = this.itemPos(it)
    if (this.w.getCollider(st.collider.handle)) {
      this.drop(st.collider)
      this.w.removeCollider(st.collider, true)
    }
    it.stuck = null
    if (!fall) return
    const def = ITEMS[it.kind]
    const body = this.w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(m(p.x), m(p.y)).setRotation(p.a).setCcdEnabled(true).setAngularDamping(1))
    const col = this.w.createCollider(
      RAPIER.ColliderDesc.capsule(m(def.r - (def.thick ?? 2)), m(def.thick ?? 2))
        .setRotation(Math.PI / 2)
        .setDensity(def.density)
        .setFriction(def.friction)
        .setCollisionGroups(groups(G_ITEM, G_ITEM | G_WINDOW | G_STATIC))
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS),
      body
    )
    this.own(col, { t: 'item', id: it.id })
    it.body = body
    it.collider = col
    // 박혔던 창 안쪽이므로 그 창들과는 빠져나올 때까지 부딪히지 않는다
    for (const w of this.wins.values()) if (this.overlapsWin(w, p.x, p.y, def.r)) it.ghost.add(w.id)
  }

  // ───────── 구조물 ─────────

  addStructure(kind: StructureKind, x: number, y: number, a = 0, s = 1, pinned = true, id = this.id()): number {
    const def = STRUCTURES[kind]
    const body = this.w.createRigidBody((pinned ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic()).setTranslation(m(x), m(y)).setRotation(a))
    const colliders: Collider[] = []
    const make = (p: Part, b: RigidBody, mat: Material): void => {
      const md = MATERIALS[p.mat ?? mat]
      const d = (p.t === 'box' ? RAPIER.ColliderDesc.cuboid(m(p.hw * s), m(p.hh * s)).setRotation(p.a ?? 0) : RAPIER.ColliderDesc.ball(m(p.r * s)))
        .setTranslation(m(p.x * s), m(p.y * s))
        .setFriction(md.friction)
        .setRestitution(md.restitution)
        .setDensity(2)
        .setCollisionGroups(pinned ? groups(G_STATIC, G_ITEM) : groups(G_ITEM, G_ITEM | G_WINDOW | G_STATIC))
      if ((p.mat ?? mat) === 'rubber') d.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      if ((p.mat ?? mat) === 'ice') d.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      colliders.push(this.own(this.w.createCollider(d, b), { t: 'struct', id, mat: p.mat ?? mat }))
    }
    for (const p of def.parts) make(p, body, def.mat)
    let moving: RigidBody | null = null
    if (def.moving) {
      if (def.moving.mode === 'spin') {
        moving = this.w.createRigidBody(RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(m(x), m(y)).setRotation(a).setAngvel(def.moving.spin ?? 1))
      } else {
        moving = this.w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(m(x), m(y)).setRotation(a).setAngularDamping(0.4))
        this.w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0 }, { x: 0, y: 0 }), body, moving, true)
      }
      for (const p of def.moving.parts) make(p, moving, def.mat)
    }
    this.structs.set(id, { id, kind, x, y, a, s, pinned, body, moving, colliders })
    return id
  }

  removeStructure(id: number): void {
    const st = this.structs.get(id)
    if (!st) return
    // 이 구조물에 박힌 화살은 떨어진다
    for (const it of this.items.values()) if (it.stuck && (it.stuck.target === st.body || it.stuck.target === st.moving)) this.unstick(it, true)
    this.removeBody(st.moving)
    this.removeBody(st.body)
    this.structs.delete(id)
  }

  /** 옮기기·돌리기: 다시 만든다 (박힌 화살은 떨어짐) */
  moveStructure(id: number, x: number, y: number, a?: number, s?: number): void {
    const st = this.structs.get(id)
    if (!st) return
    this.removeStructure(id)
    this.addStructure(st.kind, x, y, a ?? st.a, s ?? st.s, st.pinned, id)
  }

  structureAt(x: number, y: number, slop = 6): number | null {
    const hit = this.w.projectPoint({ x: m(x), y: m(y) }, true, undefined, groups(0xffff, G_STATIC) as number)
    if (hit && Math.hypot(px(hit.point.x) - x, px(hit.point.y) - y) <= slop) {
      const o = this.owners.get(hit.collider.handle)
      if (o?.t === 'struct') return o.id
    }
    // 컵 안쪽처럼 빈 곳을 눌러도 잡히게: 구조물 중심 가까이면
    let best: number | null = null
    let bd = 34
    for (const st of this.structs.values()) {
      const d = Math.hypot(st.x - x, st.y - y)
      if (d < bd) {
        bd = d
        best = st.id
      }
    }
    return best
  }

  structure(id: number): { kind: StructureKind; x: number; y: number; a: number; s: number; pinned: boolean } | null {
    const st = this.structs.get(id)
    return st ? { kind: st.kind, x: st.x, y: st.y, a: st.a, s: st.s, pinned: st.pinned } : null
  }

  /** 📌 고정 풀기/하기: 풀면 구조물도 떨어지고 밀린다 */
  setPinned(id: number, pinned: boolean): void {
    const st = this.structs.get(id)
    if (!st || st.pinned === pinned) return
    this.removeStructure(id)
    this.addStructure(st.kind, st.x, st.y, st.a, st.s, pinned, id)
  }

  get structCount(): number {
    return this.structs.size
  }

  /** 코스로 저장할 것 (웜홀·구조물·그린 선) */
  scene(): { portals: Portal[]; structs: { kind: StructureKind; x: number; y: number; a: number; s: number; pinned: boolean }[]; strokes: { mat: Material; pts: number[] }[] } {
    const portals: Portal[] = []
    // 짝끼리 붙여서 (불러올 때 차례대로 짝지어지게)
    const done = new Set<number>()
    for (const p of this.portals.values()) {
      if (done.has(p.id) || p.pair === null) continue
      const q = this.portals.get(p.pair)
      if (!q) continue
      portals.push({ ...p }, { ...q })
      done.add(p.id).add(q.id)
    }
    return {
      portals,
      structs: [...this.structs.values()].map((st) => ({ kind: st.kind, x: st.x, y: st.y, a: st.a, s: st.s, pinned: st.pinned })),
      strokes: [...this.strokes.values()].map((st) => ({ mat: st.mat, pts: st.pts }))
    }
  }

  clearScene(): void {
    this.clearItems()
    for (const id of [...this.structs.keys()]) this.removeStructure(id)
    for (const id of [...this.strokes.keys()]) this.removeStroke(id)
    this.portals.clear()
    this.attempts = 0
  }

  // ───────── 그린 선 ─────────

  addStroke(mat: Material, pts: number[], id = this.id()): number | null {
    if (pts.length < 4) return null
    const body = this.w.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    const md = MATERIALS[mat]
    // 선은 두께가 없으므로 둥근 막대 여러 개로 (빠른 구슬도 뚫고 지나가지 않게 두께를 준다)
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i]
      const ay = pts[i + 1]
      const bx = pts[i + 2]
      const by = pts[i + 3]
      const len = Math.hypot(bx - ax, by - ay)
      if (len < 0.5) continue
      const d = RAPIER.ColliderDesc.capsule(m(len / 2), m(3))
        .setTranslation(m((ax + bx) / 2), m((ay + by) / 2))
        .setRotation(Math.atan2(by - ay, bx - ax) + Math.PI / 2)
        .setFriction(md.friction)
        .setRestitution(md.restitution)
        .setCollisionGroups(groups(G_STATIC, G_ITEM))
      if (mat === 'rubber') d.setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      if (mat === 'ice') d.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      if (mat === 'glue') d.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      this.own(this.w.createCollider(d, body), { t: 'stroke', id, mat })
    }
    this.strokes.set(id, { id, mat, pts, body })
    this.strokesVersion++
    return id
  }

  removeStroke(id: number): void {
    const s = this.strokes.get(id)
    if (!s) return
    for (const it of this.items.values()) if (it.stuck?.target === s.body) this.unstick(it, true)
    this.removeBody(s.body)
    this.strokes.delete(id)
    this.strokesVersion++
  }

  strokeAt(x: number, y: number, r: number): number | null {
    for (const s of this.strokes.values()) {
      for (let i = 0; i + 3 < s.pts.length; i += 2) {
        if (distToSeg(x, y, s.pts[i], s.pts[i + 1], s.pts[i + 2], s.pts[i + 3]) <= r) return s.id
      }
    }
    return null
  }

  // ───────── 웜홀 ─────────

  /** 짝 없는 웜홀이 있으면 그것과 짝을 짓는다 */
  addPortal(x: number, y: number, a = Math.PI / 2): number {
    const id = this.id()
    const waiting = [...this.portals.values()].find((p) => p.pair === null)
    const p: Portal = { id, pair: null, x, y, a, color: waiting ? waiting.color : this.nextColor++ % 1000 }
    if (waiting) {
      waiting.pair = id
      p.pair = waiting.id
    }
    this.portals.set(id, p)
    // 근처 장난감은 바로 빨려들지 않게
    for (const it of this.items.values()) {
      const q = this.itemPos(it)
      if (Math.hypot(q.x - x, q.y - y) < PORTAL_R + ITEMS[it.kind].r) it.cool.add(id)
    }
    return id
  }

  removePortal(id: number): void {
    const p = this.portals.get(id)
    if (!p) return
    this.portals.delete(id)
    if (p.pair !== null) this.portals.delete(p.pair)
  }

  portalAt(x: number, y: number): Portal | null {
    let best: Portal | null = null
    let bd = PORTAL_R + 4
    for (const p of this.portals.values()) {
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }

  /**
   * 웜홀 통과: 짝 웜홀의 화살표 방향으로, 들어간 속력 그대로 나온다 ("빨리 들어가면 빨리 나온다").
   * 들어간 자리가 진행 방향에서 옆으로 비껴 있던 만큼 나오는 자리도 옆으로 비낀다 (여러 개가 겹쳐 나오지 않게).
   */
  warpPoint(from: Portal, to: Portal, ex: number, ey: number, vx: number, vy: number, out: number): { x: number; y: number; vx: number; vy: number; turn: number } {
    const sp = Math.hypot(vx, vy)
    const ux = Math.cos(to.a)
    const uy = Math.sin(to.a)
    // 옆으로 비낀 정도: 진행 방향에 수직인 성분 (-1 ~ 1 → 웜홀 반지름 비율)
    let side = 0
    if (sp > 1e-6) side = ((ex - from.x) * -vy + (ey - from.y) * vx) / sp / PORTAL_R
    side = Math.max(-0.7, Math.min(0.7, side))
    const nx = -uy
    const ny = ux
    const turn = to.a - (sp > 1e-6 ? Math.atan2(vy, vx) : to.a)
    return { x: to.x + ux * out + nx * side * PORTAL_R, y: to.y + uy * out + ny * side * PORTAL_R, vx: ux * sp, vy: uy * sp, turn }
  }

  /** 선분 p→q 가 원(c, r)에 처음 들어가는 점. 안 들어가면 null */
  static entry(px0: number, py0: number, qx: number, qy: number, cx: number, cy: number, r: number): { x: number; y: number } | null {
    const dx = qx - px0
    const dy = qy - py0
    const fx = px0 - cx
    const fy = py0 - cy
    const a = dx * dx + dy * dy
    const c = fx * fx + fy * fy - r * r
    if (c <= 0) return { x: px0, y: py0 } // 이미 안
    if (a < 1e-9) return null
    const b = 2 * (fx * dx + fy * dy)
    const disc = b * b - 4 * a * c
    if (disc < 0) return null
    const t = (-b - Math.sqrt(disc)) / (2 * a)
    if (t < 0 || t > 1) return null
    return { x: px0 + dx * t, y: py0 + dy * t }
  }

  private teleport(it: Item): void {
    if (!it.body || it.held) return
    const t = it.body.translation()
    const x = px(t.x)
    const y = px(t.y)
    const r = ITEMS[it.kind].r
    for (const pid of [...it.cool]) {
      const p = this.portals.get(pid)
      if (!p || Math.hypot(x - p.x, y - p.y) > PORTAL_R + r + 2) it.cool.delete(pid)
    }
    for (const p of this.portals.values()) {
      if (p.pair === null || it.cool.has(p.id)) continue
      const e = World.entry(it.prev.x, it.prev.y, x, y, p.x, p.y, PORTAL_R * 0.8)
      if (!e) continue
      const to = this.portals.get(p.pair)
      if (!to) continue
      const v = it.body.linvel()
      const o = this.warpPoint(p, to, e.x, e.y, px(v.x), px(v.y), PORTAL_R * 0.8 + 1)
      it.body.setTranslation({ x: m(o.x), y: m(o.y) }, true)
      it.body.setLinvel({ x: m(o.vx), y: m(o.vy) }, true)
      it.body.setRotation(it.body.rotation() + o.turn, true)
      it.cool.add(to.id)
      it.portals++
      it.prev = { x: o.x, y: o.y }
      // 웜홀 반대쪽이 창 안이면 그 창은 통과 (갇히지 않게)
      for (const w of this.wins.values()) if (this.overlapsWin(w, o.x, o.y, r)) it.ghost.add(w.id)
      this.fx.push({ t: 'warp', x: e.x, y: e.y, c: p.color }, { t: 'warp', x: o.x, y: o.y, c: to.color })
      return
    }
  }

  // ───────── 다른 앱 창 ─────────

  /**
   * 창 목록(앞 → 뒤)을 받아 몸체를 맞춘다. 반환: 사라진 창 id (옮기기 캐시 정리용)
   * 물리로 움직이는 창은 우리가 보낸 위치와 실제 위치가 다르면 사용자가 끄는 중으로 본다.
   */
  syncWindows(list: WinInfo[], now: number): number[] {
    const seen = new Set<number>()
    for (const info of list) {
      seen.add(info.id)
      let w = this.wins.get(info.id)
      if (w && (Math.abs(w.w - info.w) > 1 || Math.abs(w.h - info.h) > 1)) {
        // 크기가 바뀌면 다시 만든다
        this.removeWin(w)
        w = undefined
      }
      if (!w) {
        w = this.createWin(info)
        continue
      }
      w.os = { x: info.x, y: info.y }
      const t = w.body.translation()
      const bx = px(t.x) - w.w / 2
      const by = px(t.y) - w.h / 2
      if (w.mode === 'dyn') {
        // 우리가 보낸 위치와 다르고, 보낸 지 좀 지났으면 → 사용자가 옮기는 중
        const ref = w.sent ?? { x: bx, y: by }
        if (Math.hypot(info.x - ref.x, info.y - ref.y) > 4 && now - w.sentAt > 150) this.setWinMode(w, 'user', now)
      }
      if (w.mode === 'user' || w.mode === 'fixed') {
        const jump = Math.hypot(info.x - bx, info.y - by)
        if (jump > 0.5) {
          if (jump > 60) this.ghostOverlaps(w, info)
          w.body.setNextKinematicTranslation({ x: m(info.x + w.w / 2), y: m(info.y + w.h / 2) })
          w.userAt = now
        } else if (w.mode === 'user' && now - w.userAt > 400) {
          // 다 옮겼다 → 다시 물리로
          w.sent = { x: info.x, y: info.y }
          w.sentAt = now
          this.setWinMode(w, 'dyn', now)
        }
      }
    }
    const gone: number[] = []
    for (const w of [...this.wins.values()]) {
      if (!seen.has(w.id)) {
        gone.push(w.id)
        this.removeWin(w)
      }
    }
    return gone
  }

  private createWin(info: WinInfo): Win {
    const body = this.w.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(m(info.x + info.w / 2), m(info.y + info.h / 2))
        .lockRotations()
        .setGravityScale(0)
        .setLinearDamping(WIN_DAMPING)
    )
    const collider = this.w.createCollider(
      RAPIER.ColliderDesc.cuboid(m(info.w / 2), m(info.h / 2))
        .setDensity(WIN_DENSITY)
        .setFriction(0.5)
        .setRestitution(0.3)
        .setCollisionGroups(groups(G_WINDOW, G_ITEM)),
      body
    )
    this.own(collider, { t: 'window', id: info.id })
    const w: Win = { id: info.id, pid: info.pid, w: info.w, h: info.h, body, collider, mode: 'fixed', sent: null, sentAt: 0, orig: null, userAt: 0, os: { x: info.x, y: info.y }, failUntil: 0, walled: false }
    this.wins.set(info.id, w)
    this.ghostOverlaps(w, info)
    if (this.canMoveWindows) this.setWinMode(w, 'dyn', 0)
    return w
  }

  /** 창이 장난감 위로 확 옮겨지면, 겹친 장난감은 그 창을 통과시킨다 (튕겨 날아가지 않게) */
  private ghostOverlaps(w: Win, info: WinInfo): void {
    for (const it of this.items.values()) {
      if (!it.body) continue
      const p = this.itemPos(it)
      const r = ITEMS[it.kind].r
      if (p.x > info.x - r && p.x < info.x + info.w + r && p.y > info.y - r && p.y < info.y + info.h + r) it.ghost.add(w.id)
    }
  }

  private removeWin(w: Win): void {
    for (const it of this.items.values()) {
      if (it.stuck?.windowId === w.id) this.unstick(it, true)
      it.ghost.delete(w.id)
    }
    this.removeBody(w.body)
    this.wins.delete(w.id)
  }

  private setWinMode(w: Win, mode: Win['mode'], now: number): void {
    if (w.mode === mode) return
    w.mode = mode
    if (mode === 'dyn') {
      w.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
      w.body.setLinvel({ x: 0, y: 0 }, true)
    } else {
      w.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
      w.userAt = now
    }
  }

  setCanMoveWindows(on: boolean, now: number): void {
    if (on === this.canMoveWindows) return
    this.canMoveWindows = on
    for (const w of this.wins.values()) this.setWinMode(w, on ? 'dyn' : 'fixed', now)
  }

  /** 실제 창에 보낼 위치 (움직인 창만) */
  windowMoves(now: number): Move[] {
    const out: Move[] = []
    for (const w of this.wins.values()) {
      if (w.mode !== 'dyn' || w.failUntil > now) continue
      const t = w.body.translation()
      const x = Math.round(px(t.x) - w.w / 2)
      const y = Math.round(px(t.y) - w.h / 2)
      const ref = w.sent ?? w.os
      if (Math.abs(x - ref.x) < 1 && Math.abs(y - ref.y) < 1) continue
      w.orig ??= { ...w.os }
      w.sent = { x, y }
      w.sentAt = now
      out.push({ id: w.id, pid: w.pid, x, y, from: { ...w.os, w: w.w, h: w.h } })
    }
    return out
  }

  /** 옮기기 실패 → 잠깐 실제 위치를 따라가게 */
  moveFailed(id: number, now: number): void {
    const w = this.wins.get(id)
    if (!w) return
    w.failUntil = now + 2000
    w.body.setTranslation({ x: m(w.os.x + w.w / 2), y: m(w.os.y + w.h / 2) }, true)
    w.body.setLinvel({ x: 0, y: 0 }, true)
    w.sent = { ...w.os }
  }

  /** 원위치: 옮긴 창을 처음 자리로. 반환: 실제 창에 보낼 위치 */
  restoreWindows(now: number): Move[] {
    const out: Move[] = []
    for (const w of this.wins.values()) {
      if (!w.orig) continue
      this.ghostOverlaps(w, { id: w.id, pid: w.pid, x: w.orig.x, y: w.orig.y, w: w.w, h: w.h })
      w.body.setTranslation({ x: m(w.orig.x + w.w / 2), y: m(w.orig.y + w.h / 2) }, true)
      w.body.setLinvel({ x: 0, y: 0 }, true)
      w.sent = { ...w.orig }
      w.sentAt = now
      out.push({ id: w.id, pid: w.pid, x: w.orig.x, y: w.orig.y, from: { ...w.os, w: w.w, h: w.h } })
      w.orig = null
    }
    return out
  }

  get movedWindows(): number {
    let n = 0
    for (const w of this.wins.values()) if (w.orig) n++
    return n
  }

  // ───────── 손 도구 (잡아서 던지기) ─────────

  itemAt(x: number, y: number, slop = 10): number | null {
    let best: number | null = null
    let bd = Infinity
    for (const it of this.items.values()) {
      const p = this.itemPos(it)
      const d = Math.hypot(p.x - x, p.y - y) - ITEMS[it.kind].r
      if (d < slop && d < bd) {
        bd = d
        best = it.id
      }
    }
    return best
  }

  grabItem(id: number, x: number, y: number): void {
    const it = this.items.get(id)
    if (!it) return
    if (it.stuck) this.unstick(it, true)
    it.held = true
    this.grab = { id, x, y }
  }

  dragTo(x: number, y: number): void {
    if (this.grab) {
      this.grab.x = x
      this.grab.y = y
    }
  }

  release(): void {
    const g = this.grab
    this.grab = null
    if (!g) return
    const it = this.items.get(g.id)
    if (!it) return
    it.held = false
    if (it.body) {
      // 너무 세게는 못 던지게
      const v = it.body.linvel()
      const sp = Math.hypot(v.x, v.y)
      const max = m(4500)
      if (sp > max) it.body.setLinvel({ x: (v.x / sp) * max, y: (v.y / sp) * max }, true)
      this.attempts++
    }
  }

  // ───────── 한 단계 ─────────

  step(now: number): void {
    this.time += DT
    // 잡은 장난감: 커서 쪽으로 끌어당기는 속도
    if (this.grab) {
      const it = this.items.get(this.grab.id)
      if (it?.body) {
        const t = it.body.translation()
        it.body.setLinvel({ x: (m(this.grab.x) - t.x) * 25, y: (m(this.grab.y) - t.y) * 25 }, true)
        it.body.setAngvel(it.body.angvel() * 0.9, true)
      }
    }
    for (const it of this.items.values()) {
      if (!it.body) continue
      const t = it.body.translation()
      it.prev = { x: px(t.x), y: px(t.y) }
      let v = it.body.linvel()
      const sp = Math.hypot(v.x, v.y)
      if (sp > MAX_SPEED) {
        v = { x: (v.x / sp) * MAX_SPEED, y: (v.y / sp) * MAX_SPEED }
        it.body.setLinvel(v, true)
      }
      it.speed = px(Math.min(sp, MAX_SPEED))
      // 화살·다트는 날아가는 방향을 본다
      if (ITEMS[it.kind].shape === 'stick' && it.speed > 150 && !it.held) {
        it.body.setRotation(Math.atan2(v.y, v.x), false)
        it.body.setAngvel(0, false)
      }
      // 끈끈이·컨베이어
      let glue = false
      for (const o of it.touching.values()) {
        if ((o.t === 'stroke' || o.t === 'struct') && o.mat === 'glue') glue = true
        if (o.t === 'struct') {
          const st = this.structs.get(o.id)
          const belt = st && STRUCTURES[st.kind].belt
          if (st && belt) {
            const ux = Math.cos(st.a)
            const uy = Math.sin(st.a)
            const vt = px(v.x * ux + v.y * uy)
            const dv = (belt * st.s - vt) * 0.2
            it.body.setLinvel({ x: v.x + m(dv * ux), y: v.y + m(dv * uy) }, true)
          }
        }
      }
      it.body.setLinearDamping(glue ? 25 : 0.02)
      if (glue) it.body.setAngularDamping(25)
    }

    this.w.step(this.events, this.hooks)

    this.events.drainCollisionEvents((h1, h2, started) => {
      const a = this.owners.get(h1)
      const b = this.owners.get(h2)
      if (!a || !b) return
      if (a.t === 'item') this.onContact(a.id, b, h2, started)
      if (b.t === 'item') this.onContact(b.id, a, h1, started)
    })

    const dead: number[] = []
    for (const it of this.items.values()) {
      if (it.stuck) continue
      this.teleport(it)
      if (!it.body) continue
      const p = this.itemPos(it)
      const r = ITEMS[it.kind].r
      // 완전히 빠져나온 창은 다시 부딪힌다
      for (const wid of [...it.ghost]) {
        const w = this.wins.get(wid)
        if (!w || !this.overlapsWin(w, p.x, p.y, r)) it.ghost.delete(wid)
      }
      this.checkGoals(it, p)
      if (it.fuse > 0) {
        it.fuse -= DT
        if (it.fuse <= 0) {
          this.explode(p.x, p.y)
          dead.push(it.id)
          continue
        }
      }
      // 화면 밖으로 나가 3초 → 치움
      if (!this.onScreen(p.x, p.y, 200)) {
        it.outside += DT
        if (it.outside > 3) dead.push(it.id)
      } else it.outside = 0
    }
    for (const id of dead) this.removeItem(id)
    for (const st of this.structs.values()) {
      if (st.pinned) continue
      const t = st.body.translation()
      st.x = px(t.x)
      st.y = px(t.y)
      st.a = st.body.rotation()
    }
    this.settleWindows()
    void now
  }

  private onContact(itemId: number, other: Owner, otherHandle: number, started: boolean): void {
    const it = this.items.get(itemId)
    if (!it) return
    if (!started) {
      it.touching.delete(otherHandle)
      return
    }
    it.touching.set(otherHandle, other)
    if (!it.body) return
    if (other.t === 'item') return
    if (other.t === 'window' && it.ghost.has(other.id)) return
    it.bounces++
    const p = this.itemPos(it)
    const def = ITEMS[it.kind]
    // 박히기: 빠른 화살·다트가 창·나무에
    if (def.sticks && it.speed > 700 && (other.t === 'window' || ((other.t === 'struct' || other.t === 'stroke') && (other.mat === 'wood' || other.mat === 'glue')))) {
      const c = this.w.getCollider(otherHandle)
      if (c) {
        this.stick(it, c, other)
        return
      }
    }
    // 수박: 세게 부딪히면 깨진다
    if (it.kind === 'watermelon' && it.speed > 1100) {
      this.splat(it, p.x, p.y)
      return
    }
    if (other.t === 'struct') {
      const st = this.structs.get(other.id)
      if (st) this.structKick(st, it, p)
    }
    if (it.speed > 120) this.fx.push({ t: 'hit', x: p.x, y: p.y, v: Math.min(1, it.speed / 2500), k: it.kind, m: other.t === 'window' ? 'window' : other.t === 'wall' ? 'wall' : other.mat })
  }

  private structKick(st: Structure, it: Item, p: { x: number; y: number }): void {
    const def = STRUCTURES[st.kind]
    if (def.bell) this.fx.push({ t: 'bell', x: st.x, y: st.y })
    if (!def.kick || !it.body) return
    let nx: number
    let ny: number
    if (def.kick.mode === 'out') {
      nx = p.x - st.x
      ny = p.y - st.y
    } else {
      // 스프링: 위쪽(구조물의 -y)에서 닿았을 때만
      nx = Math.sin(st.a)
      ny = -Math.cos(st.a)
      if ((p.x - st.x) * nx + (p.y - st.y) * ny < 0) return
    }
    const l = Math.hypot(nx, ny) || 1
    nx /= l
    ny /= l
    const v = it.body.linvel()
    const sp = m(def.kick.speed * st.s)
    // 법선 방향 속도를 정해진 값으로 (접선 방향은 그대로)
    const vn = v.x * nx + v.y * ny
    const add = Math.max(0, sp - vn)
    it.body.setLinvel({ x: v.x + nx * add, y: v.y + ny * add }, true)
    this.fx.push({ t: 'kick', x: p.x, y: p.y, k: st.kind })
  }

  private splat(it: Item, x: number, y: number): void {
    const v = it.body!.linvel()
    this.removeItem(it.id)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      this.spawnItem('chunk', x + Math.cos(a) * 8, y + Math.sin(a) * 8, px(v.x) * 0.3 + Math.cos(a) * 300, px(v.y) * 0.3 + Math.sin(a) * 300 - 200)
    }
    this.fx.push({ t: 'splat', x, y })
  }

  private explode(x: number, y: number): void {
    const R = 240
    for (const it of this.items.values()) {
      if (!it.body) continue
      const p = this.itemPos(it)
      const d = Math.hypot(p.x - x, p.y - y)
      if (d > R || d < 1) continue
      const f = (1 - d / R) * 2600
      it.body.setLinvel({ x: it.body.linvel().x + m(((p.x - x) / d) * f), y: it.body.linvel().y + m(((p.y - y) / d) * f) }, true)
    }
    for (const w of this.wins.values()) {
      if (w.mode !== 'dyn') continue
      const t = w.body.translation()
      // 창 가장자리까지 거리
      const cx = Math.max(px(t.x) - w.w / 2, Math.min(x, px(t.x) + w.w / 2))
      const cy = Math.max(px(t.y) - w.h / 2, Math.min(y, px(t.y) + w.h / 2))
      const d = Math.hypot(cx - x, cy - y)
      if (d > R) continue
      let dx = px(t.x) - x
      let dy = px(t.y) - y
      const l = Math.hypot(dx, dy) || 1
      dx /= l
      dy /= l
      // 작은 창일수록 멀리 (넓이로 나눔)
      const kick = ((1 - d / R) * 900 * 250000) / Math.max(60000, w.w * w.h)
      w.body.setLinvel({ x: w.body.linvel().x + m(dx * kick), y: w.body.linvel().y + m(dy * kick) }, true)
    }
    this.fx.push({ t: 'boom', x, y })
  }

  /** 창: 너무 느리면 멈추고(정지 마찰), 너무 빠르지 않게 */
  private settleWindows(): void {
    for (const w of this.wins.values()) {
      if (w.mode !== 'dyn') continue
      if (!w.walled) {
        const t = w.body.translation()
        const x = px(t.x) - w.w / 2
        const y = px(t.y) - w.h / 2
        const inside = this.displays.some((d) => x >= d.work.x - 1 && y >= d.work.y - 1 && x + w.w <= d.work.x + d.work.w + 1 && y + w.h <= d.work.y + d.work.h + 1)
        if (inside) {
          w.walled = true
          w.collider.setCollisionGroups(groups(G_WINDOW, G_ITEM | G_WINWALL))
        } else {
          // 벽이 없는 동안에도 화면 밖으로 더 나가지는 않게 (잃어버리지 않도록)
          const d = this.nearestWork(x, y, w.w, w.h)
          const v = w.body.linvel()
          let vx = v.x
          let vy = v.y
          if ((x < d.x && vx < 0) || (x + w.w > d.x + d.w && vx > 0)) vx = 0
          if ((y < d.y && vy < 0) || (y + w.h > d.y + d.h && vy > 0)) vy = 0
          if (vx !== v.x || vy !== v.y) w.body.setLinvel({ x: vx, y: vy }, true)
        }
      }
      const v = w.body.linvel()
      const sp = Math.hypot(v.x, v.y)
      // 운동 마찰: 매 단계 일정하게 느려진다 → 무거운 게 계속 누르면 그 힘이 마찰을 넘을 때만 내려간다
      const slow = Math.max(0, sp - WIN_FRICTION * DT)
      if (slow < WIN_STICK) {
        if (sp > 0) w.body.setLinvel({ x: 0, y: 0 }, false)
      } else {
        const k = Math.min(slow, WIN_MAX_SPEED) / sp
        w.body.setLinvel({ x: v.x * k, y: v.y * k }, true)
      }
    }
  }

  private nearestWork(x: number, y: number, w: number, h: number): Rect {
    let best = this.displays[0]?.work ?? { x: 0, y: 0, w: 1e5, h: 1e5 }
    let ba = -1
    for (const d of this.displays) {
      const a = Math.max(0, Math.min(x + w, d.work.x + d.work.w) - Math.max(x, d.work.x)) * Math.max(0, Math.min(y + h, d.work.y + d.work.h) - Math.max(y, d.work.y))
      if (a > ba) {
        ba = a
        best = d.work
      }
    }
    return best
  }

  // ───────── 골인 ─────────

  private checkGoals(it: Item, p: { x: number; y: number }): void {
    if (it.kind === 'chunk' || !it.body) return
    for (const st of this.structs.values()) {
      const goal = STRUCTURES[st.kind].goal
      if (!goal || it.scored.has(st.id)) continue
      const dx = p.x - st.x
      const dy = p.y - st.y
      if (dx * dx + dy * dy > 200 * 200 * st.s * st.s) continue
      const c = Math.cos(-st.a)
      const s = Math.sin(-st.a)
      const lx = (dx * c - dy * s) / st.s
      const ly = (dx * s + dy * c) / st.s
      const inside = Math.abs(lx - goal.x) < goal.hw && Math.abs(ly - goal.y) < goal.hh
      if (!inside) {
        it.goalTime.delete(st.id)
        continue
      }
      const v = it.body.linvel()
      if (goal.mode === 'rest') {
        const tm = (it.goalTime.get(st.id) ?? 0) + DT
        it.goalTime.set(st.id, tm)
        if (tm < 0.35) continue
      } else {
        // 골대: 위에서 아래로 지나갈 때
        const vly = px(v.x * s + v.y * c)
        const plx = it.prev.x - st.x
        const ply = it.prev.y - st.y
        const prevLy = (plx * s + ply * c) / st.s
        if (!(vly > 50 && prevLy < goal.y)) continue
      }
      it.scored.add(st.id)
      this.fx.push({ t: 'goal', x: st.x, y: st.y, k: st.kind, bounces: it.bounces, portals: it.portals, attempts: Math.max(1, this.attempts), item: it.kind, id: it.id, age: this.time - it.born })
      this.attempts = 0
    }
  }

  // ───────── 미리보기 궤적 ─────────

  /**
   * 새총 궤적: 공을 같은 조건으로 따로 굴려 본다 (부딪히면 법선으로 튕김, 웜홀 통과 포함).
   * 실제 물리와 조금 다를 수 있다 — 미리보기라서 "대략" 이면 된다.
   */
  predict(kind: ItemKind, x: number, y: number, vx: number, vy: number, maxBounces: number, maxTime = 2.4): number[] {
    const def = ITEMS[kind]
    const pts: number[] = [x, y]
    let bounces = 0
    const cool = new Set<number>()
    const g = px(GRAVITY)
    const dt = 1 / 60
    const e = Math.max(0.15, def.restitution * 0.8)
    for (let t = 0; t < maxTime; t += dt) {
      vy += g * dt
      let nx = x + vx * dt
      let ny = y + vy * dt
      const dist = Math.hypot(nx - x, ny - y)
      if (dist > 0.01) {
        const ray = new RAPIER.Ray({ x: m(x), y: m(y) }, { x: (nx - x) / dist, y: (ny - y) / dist })
        const hit = this.w.castRayAndGetNormal(ray, m(dist + def.r), true, undefined, groups(G_ITEM, G_STATIC | G_WINDOW) as number)
        if (hit && px(hit.timeOfImpact) <= dist + def.r) {
          const toi = Math.max(0, px(hit.timeOfImpact) - def.r)
          x += ((nx - x) / dist) * toi
          y += ((ny - y) / dist) * toi
          pts.push(x, y)
          if (++bounces > maxBounces) return pts
          const n = hit.normal
          const vn = vx * n.x + vy * n.y
          vx = (vx - (1 + e) * vn * n.x) * 0.95
          vy = (vy - (1 + e) * vn * n.y) * 0.95
          if (def.sticks) return pts
          continue
        }
      }
      for (const c of [...cool]) {
        const p = this.portals.get(c)
        if (!p || Math.hypot(nx - p.x, ny - p.y) > PORTAL_R + 2) cool.delete(c)
      }
      let warped = false
      for (const p of this.portals.values()) {
        if (p.pair === null || cool.has(p.id)) continue
        const en = World.entry(x, y, nx, ny, p.x, p.y, PORTAL_R * 0.8)
        const to = en && this.portals.get(p.pair)
        if (!en || !to) continue
        pts.push(en.x, en.y, NaN, NaN)
        const o = this.warpPoint(p, to, en.x, en.y, vx, vy, PORTAL_R * 0.8 + 1)
        nx = o.x
        ny = o.y
        vx = o.vx
        vy = o.vy
        cool.add(to.id)
        warped = true
        break
      }
      x = nx
      y = ny
      if (warped || pts.length < 4 || Math.hypot(x - pts[pts.length - 2], y - pts[pts.length - 1]) > 6) pts.push(x, y)
      if (!this.onScreen(x, y, 50)) break
    }
    return pts
  }

  // ───────── 그림으로 보낼 것 ─────────

  frame(): Frame {
    const items: number[] = []
    let fast: { x: number; y: number; v: number } | null = null
    for (const it of this.items.values()) {
      const p = this.itemPos(it)
      const flags = (it.stuck ? 1 : 0) | (it.held ? 2 : 0) | (it.fuse > 0 && it.fuse < 1 && Math.floor(it.fuse * 10) % 2 ? 4 : 0)
      items.push(it.id, ITEM_INDEX[it.kind], Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.a * 1000) / 1000, flags)
      if (!it.stuck && it.speed > 1600 && (!fast || it.speed > fast.v)) fast = { x: p.x, y: p.y, v: it.speed }
    }
    const structs: StructView[] = []
    for (const st of this.structs.values()) {
      const v: StructView = { id: st.id, k: st.kind, x: st.x, y: st.y, a: st.a, s: st.s }
      if (!st.pinned) {
        const t = st.body.translation()
        v.x = px(t.x)
        v.y = px(t.y)
        v.a = st.body.rotation()
      }
      if (st.moving) {
        const t = st.moving.translation()
        v.m = { x: px(t.x), y: px(t.y), a: st.moving.rotation() }
      }
      structs.push(v)
    }
    const portals: PortalView[] = [...this.portals.values()].map((p) => ({ id: p.id, pair: p.pair, x: p.x, y: p.y, a: p.a, c: p.color }))
    const fx = this.fx
    this.fx = []
    // 1px = 1cm 로 치면 px/s × 0.036 = km/h
    return { items, structs, portals, fx, speed: fast ? { x: fast.x, y: fast.y, kmh: Math.round(fast.v * 0.036) } : null }
  }

  strokeViews(): StrokeView[] {
    return [...this.strokes.values()].map((s) => ({ id: s.id, mat: s.mat, pts: s.pts }))
  }

  windowRects(): { id: number; x: number; y: number; w: number; h: number; mode: string }[] {
    return [...this.wins.values()].map((w) => {
      const t = w.body.translation()
      return { id: w.id, x: px(t.x) - w.w / 2, y: px(t.y) - w.h / 2, w: w.w, h: w.h, mode: w.mode }
    })
  }
}

export const ITEM_INDEX: Record<ItemKind, number> = Object.fromEntries((Object.keys(ITEMS) as ItemKind[]).map((k, i) => [k, i])) as Record<ItemKind, number>

export function distToSeg(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t))
}
