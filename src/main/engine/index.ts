// 엔진: 물리 세계 + 도구 + 실제 창 동기화 + 커서 웜홀. 메인 프로세스에서 8ms 마다 돈다.
// 아무것도 없고 도구도 안 쓰면 멈춘다 (CPU 0).
import { screen } from 'electron'
import { PORTAL_R } from '@shared/defs'
import type { FramePacket, Settings, Tool } from '@shared/types'
import type { Overlays } from '../overlays'
import { listWindows, type WinRect } from '../windows'
import { createInput, type Input } from '../windows/input'
import { getMover, type Mover } from '../windows/move'
import { Tools } from './tools'
import { DT, World, type Display, type Move, type WinInfo } from './world'

/** 가짜 입력 (헤드리스 테스트) */
export interface FakeInput {
  x: number
  y: number
  left: boolean
  right: boolean
}

export class Engine {
  readonly world = new World()
  readonly tools: Tools
  private input: Input
  private mover: Mover | null
  private timer: NodeJS.Timeout | null = null
  private last = 0
  private acc = 0
  private frameAcc = 0
  private winAt = 0
  private permAt = 0
  private strokesSent = -1
  private cursorPrev: { x: number; y: number } | null = null
  private cursorCool = new Set<number>()
  private fx: FramePacket['fx'] = []
  /** 헤드리스 테스트: 진짜 커서·창 대신 */
  fake: FakeInput | null = null
  fakeWindows: WinRect[] | null = null
  /** 공구함에 알릴 게 바뀜 */
  onChange: (() => void) | null = null

  constructor(
    private overlays: Overlays,
    private settings: () => Settings,
    private debug = false
  ) {
    this.tools = new Tools(this.world, () => this.settings().preview)
    this.input = createInput()
    this.mover = getMover()
  }

  setDisplays(): void {
    const ds: Display[] = this.overlays.displays().map((d) => ({
      bounds: { x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height },
      work: { x: d.workArea.x, y: d.workArea.y, w: d.workArea.width, h: d.workArea.height }
    }))
    this.world.setDisplays(ds)
    this.wake()
  }

  get canMove(): boolean {
    if (this.fakeWindows) return true
    return !!this.mover?.canMove()
  }

  /** 실제 창 옮기기 (테스트: 가짜 창 목록을 고친다) */
  private moveWindow(id: number, pid: number, x: number, y: number, from?: Move['from']): boolean {
    if (this.fakeWindows) {
      const w = this.fakeWindows.find((r) => r.id === id)
      if (w) Object.assign(w, { x, y })
      return !!w
    }
    return !!this.mover?.move(id, pid, x, y, from)
  }

  setTool(t: Tool): void {
    this.tools.setTool(t)
    this.overlays.setCapture(t.t !== 'none')
    this.wake()
  }

  /** 할 일이 있으면 루프를 돌린다 */
  wake(): void {
    const active = this.tools.tool.t !== 'none' || !this.world.empty
    this.overlays.setVisible(active)
    if (active && !this.timer) {
      this.last = performance.now()
      this.acc = 0
      this.timer = setInterval(() => this.tick(), 8)
    } else if (!active && this.timer) {
      this.send() // 빈 화면 한 번
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    const t = performance.now()
    const dt = Math.min(0.1, (t - this.last) / 1000)
    this.last = t
    const now = Date.now()

    // 권한은 가끔 확인 (켜자마자 반영)
    if (now - this.permAt > 2000) {
      this.permAt = now
      const can = this.settings().pushWindows && this.canMove
      if (can !== this.world.canMoveWindows) {
        this.world.setCanMoveWindows(can, now)
        this.onChange?.()
      }
    }
    // 창 목록: 15Hz
    if (now - this.winAt > 66) {
      this.winAt = now
      const gone = this.world.syncWindows(this.windows(), now)
      for (const id of gone) this.mover?.forget(id)
    }

    const c = this.fake ?? { ...screen.getCursorScreenPoint(), ...this.input.buttons() }
    this.tools.update(c.x, c.y, c.left, c.right)
    if (this.settings().cursorWarp && !this.fake) this.cursorWormhole(c.x, c.y, c.left || c.right)

    this.acc += dt
    let steps = 0
    while (this.acc >= DT && steps < 4) {
      this.world.step(now)
      this.acc -= DT
      steps++
    }
    if (steps === 4) this.acc = 0 // 밀리면 따라잡지 않고 버린다

    // 실제 창 옮기기
    if (this.world.canMoveWindows) {
      for (const mv of this.world.windowMoves(now)) if (!this.moveWindow(mv.id, mv.pid, mv.x, mv.y, mv.from)) this.world.moveFailed(mv.id, now)
    }

    this.frameAcc += dt
    if (this.frameAcc >= 1 / 60) {
      this.frameAcc = 0
      this.send()
    }
    if (this.tools.changed) {
      this.tools.changed = false
      this.onChange?.()
    }
    if (this.tools.tool.t === 'none' && this.world.empty) this.wake()
  }

  /** 오버레이마다 그 화면 근처 것만 */
  private send(): void {
    const f = this.world.frame()
    f.fx.push(...this.fx)
    this.fx = []
    const ui = this.tools.view()
    const wins = this.debug ? this.world.windowRects() : undefined
    const sendStrokes = this.strokesSent !== this.world.strokesVersion
    this.strokesSent = this.world.strokesVersion
    const strokes = sendStrokes ? this.world.strokeViews() : null
    this.overlays.each((b, send) => {
      const M = 160
      const items: number[] = []
      for (let i = 0; i < f.items.length; i += 6) {
        const x = f.items[i + 2]
        const y = f.items[i + 3]
        if (x > b.x - M && x < b.x + b.w + M && y > b.y - M && y < b.y + b.h + M) items.push(...f.items.slice(i, i + 6))
      }
      const fx = f.fx.filter((e) => e.x > b.x - 300 && e.x < b.x + b.w + 300 && e.y > b.y - 300 && e.y < b.y + b.h + 300)
      const pkt: FramePacket = { ...f, items, fx, ui, wins }
      if (strokes) send('overlay:scene', { strokes })
      send('overlay:frame', pkt)
    })
  }

  /** 다시 그리기 (오버레이를 새로 띄웠을 때) */
  resendScene(): void {
    this.strokesSent = -1
    this.send()
  }

  // ───────── 실제 창 ─────────

  private windows(): WinInfo[] {
    const raw = this.fakeWindows ?? listWindows()
    const ds = this.overlays.displays()
    const out: WinInfo[] = []
    const front: WinRect[] = []
    for (const r of raw) {
      const skip =
        this.overlays.exclude.has(r.id) ||
        r.pid === process.pid ||
        r.w < 120 ||
        r.h < 60 ||
        // 최대화·전체화면 창은 배경으로 본다 (밀면 화면이 통째로 움직이니)
        ds.some((d) => r.w * r.h >= d.workArea.width * d.workArea.height * 0.85 && overlap(r, { x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height }) > 0.9)
      if (!skip && visibleFraction(r, front) >= 0.3) out.push({ id: r.id, pid: r.pid, x: r.x, y: r.y, w: r.w, h: r.h })
      front.push(r)
    }
    return out
  }

  restoreWindows(): void {
    const now = Date.now()
    for (const mv of this.world.restoreWindows(now)) this.moveWindow(mv.id, mv.pid, mv.x, mv.y, mv.from)
    this.onChange?.()
  }

  // ───────── 커서 웜홀 ─────────

  private cursorWormhole(x: number, y: number, pressed: boolean): void {
    const prev = this.cursorPrev
    this.cursorPrev = { x, y }
    for (const id of [...this.cursorCool]) {
      const p = this.world.portals.get(id)
      if (!p || Math.hypot(x - p.x, y - p.y) > PORTAL_R + 8) this.cursorCool.delete(id)
    }
    // 끄는 중에는 옮기지 않는다 (드래그하던 게 엉뚱한 데 떨어지지 않게)
    if (!prev || pressed) return
    for (const p of this.world.portals.values()) {
      if (p.pair === null || this.cursorCool.has(p.id)) continue
      const e = World.entry(prev.x, prev.y, x, y, p.x, p.y, PORTAL_R * 0.7)
      const to = e && this.world.portals.get(p.pair)
      if (!e || !to) continue
      const o = this.world.warpPoint(p, to, e.x, e.y, x - prev.x, y - prev.y, PORTAL_R + 6)
      // 들어온 속도만큼 조금 더 밀어 준다
      const tx = o.x + o.vx
      const ty = o.y + o.vy
      if (this.input.warp(tx, ty)) {
        this.cursorCool.add(to.id)
        this.cursorPrev = { x: tx, y: ty }
        this.fx.push({ t: 'cursor-warp', x: e.x, y: e.y, c: p.color }, { t: 'cursor-warp', x: tx, y: ty, c: to.color })
      }
      return
    }
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

function overlap(a: WinRect, b: { x: number; y: number; w: number; h: number }): number {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return (w * h) / Math.max(1, a.w * a.h)
}

/** 앞 창들에 가려지지 않은 비율 (8×8 점 표본) */
function visibleFraction(r: WinRect, front: WinRect[]): number {
  if (!front.length) return 1
  let vis = 0
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const x = r.x + ((i + 0.5) / 8) * r.w
      const y = r.y + ((j + 0.5) / 8) * r.h
      if (!front.some((f) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h)) vis++
    }
  }
  return vis / 64
}
