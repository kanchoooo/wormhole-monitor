// 자동 조작 (헤드리스 테스트·홍보 화면 만들기용). WH_SCRIPT=경로.json
// [{ "at": 밀리초, ...동작 }] — 동작: tool · down/move/up [x,y] · rdown/rup · spawn · portal · struct · stroke
//                                  shot "이름.png" · windows [WinRect…] · quit
import { writeFileSync } from 'fs'
import { join } from 'path'
import type { ItemKind, Material, StructureKind } from '@shared/defs'
import type { Tool } from '@shared/types'
import type { WinRect } from '../windows'
import type { Engine } from './index'

export interface Step {
  at: number
  tool?: Tool
  down?: [number, number]
  move?: [number, number]
  up?: [number, number]
  /** down 에서 to 까지 n 번 나눠 움직이고 뗀다 (끌기) */
  drag?: { from: [number, number]; to: [number, number]; ms?: number }
  rdown?: [number, number]
  rup?: [number, number]
  spawn?: { kind: ItemKind; x: number; y: number; vx?: number; vy?: number }
  portal?: [number, number, number?]
  struct?: { kind: StructureKind; x: number; y: number; a?: number; s?: number }
  stroke?: { mat: Material; pts: number[] }
  windows?: WinRect[]
  shot?: string
  log?: string
  quit?: boolean
}

export function runScript(steps: Step[], engine: Engine, shotDir: string, capture: () => Promise<Buffer | null>, quit: () => void): void {
  engine.fake = { x: 0, y: 0, left: false, right: false }
  const f = engine.fake
  const t0 = Date.now()
  for (const s of steps) {
    setTimeout(async () => {
      if (s.windows) engine.fakeWindows = s.windows
      if (s.tool) engine.setTool(s.tool)
      if (s.move) Object.assign(f, { x: s.move[0], y: s.move[1] })
      if (s.down) Object.assign(f, { x: s.down[0], y: s.down[1], left: true })
      if (s.up) Object.assign(f, { x: s.up[0], y: s.up[1], left: false })
      if (s.rdown) Object.assign(f, { x: s.rdown[0], y: s.rdown[1], right: true })
      if (s.rup) Object.assign(f, { x: s.rup[0], y: s.rup[1], right: false })
      if (s.drag) {
        const { from, to } = s.drag
        const ms = s.drag.ms ?? 300
        Object.assign(f, { x: from[0], y: from[1], left: true })
        const n = Math.max(2, Math.round(ms / 16))
        for (let i = 1; i <= n; i++) {
          setTimeout(() => {
            f.x = from[0] + ((to[0] - from[0]) * i) / n
            f.y = from[1] + ((to[1] - from[1]) * i) / n
            if (i === n) setTimeout(() => (f.left = false), 40)
          }, (ms * i) / n)
        }
      }
      if (s.spawn) engine.world.spawnItem(s.spawn.kind, s.spawn.x, s.spawn.y, s.spawn.vx ?? 0, s.spawn.vy ?? 0, true)
      if (s.portal) engine.world.addPortal(s.portal[0], s.portal[1], s.portal[2] ?? 0)
      if (s.struct) engine.world.addStructure(s.struct.kind, s.struct.x, s.struct.y, s.struct.a ?? 0, s.struct.s ?? 1)
      if (s.stroke) engine.world.addStroke(s.stroke.mat, s.stroke.pts)
      engine.wake()
      if (s.log) console.log(`[script ${Date.now() - t0}ms] ${s.log}`)
      if (s.shot) {
        const png = await capture()
        if (png) {
          writeFileSync(join(shotDir, s.shot), png)
          console.log(`[script] shot ${s.shot}`)
        }
      }
      if (s.quit) quit()
    }, s.at)
  }
}
