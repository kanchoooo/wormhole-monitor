// 물리 세계 단위 확인 (Electron 없이): node test/run.mjs
import { CHALLENGES } from '../src/shared/courses'
import { decodeCourse, encodeCourse, exportCourse, importCourse } from '../src/main/courses'
import { initPhysics, World } from '../src/main/engine/world'

async function main(): Promise<void> {
  await initPhysics()
  const results: [string, boolean, string][] = []
  const ok = (name: string, cond: boolean, info = ''): void => {
    results.push([name, cond, info])
  }
  const screen = { bounds: { x: 0, y: 0, w: 1440, h: 900 }, work: { x: 0, y: 25, w: 1440, h: 815 } }

  // 1) 컵 골인
  {
    const w = new World()
    w.setDisplays([screen])
    w.addStructure('cup', 860, 790)
    w.spawnItem('marble', 860, 650, 0, 0, true)
    let goal = null as unknown
    for (let i = 0; i < 240; i++) {
      w.step(0)
      const f = w.frame()
      for (const e of f.fx) if (e.t === 'goal') goal = e
    }
    const it = w.frame().items
    ok('컵에 떨어뜨리면 골인', !!goal, `구슬 위치 ${it[2]?.toFixed(0)},${it[3]?.toFixed(0)} ${JSON.stringify(goal)}`)
  }

  // 2) 웜홀 무한 낙하: 아래 웜홀(↑) → 위 웜홀(↓)
  {
    const w = new World()
    w.setDisplays([screen])
    w.addPortal(700, 780, -Math.PI / 2)
    w.addPortal(700, 110, Math.PI / 2)
    w.spawnItem('marble', 700, 600)
    let warps = 0
    let maxKmh = 0
    for (let i = 0; i < 120 * 6; i++) {
      w.step(0)
      const f = w.frame()
      warps += f.fx.filter((e) => e.t === 'warp').length / 2
      if (f.speed) maxKmh = Math.max(maxKmh, f.speed.kmh)
    }
    ok('무한 낙하 고리', warps >= 4, `통과 ${warps}번, 최고 ${maxKmh} km/h`)
    ok('끝없이 빨라지지 않음', maxKmh <= 1000, `${maxKmh} km/h`)
  }

  // 3) 창 위에 볼링공: 조금만 내려감, 구슬은 버팀
  {
    const w = new World()
    w.setDisplays([screen])
    w.setCanMoveWindows(true, 0)
    w.syncWindows([{ id: 1, pid: 1, x: 300, y: 300, w: 400, h: 300 }], 0)
    w.spawnItem('marble', 400, 280)
    w.spawnItem('marble', 450, 280)
    w.spawnItem('marble', 500, 280)
    for (let i = 0; i < 240; i++) w.step(0)
    const y1 = w.windowRects()[0].y
    ok('구슬 3개는 창이 버팀', Math.abs(y1 - 300) < 2, `창 y ${y1.toFixed(1)}`)
    w.spawnItem('bowling', 500, 0)
    for (let i = 0; i < 120 * 2; i++) w.step(0)
    const y2 = w.windowRects()[0].y
    ok('볼링공을 떨어뜨리면 창이 조금 내려감', y2 - y1 > 5 && y2 - y1 < 120, `창 y ${y1.toFixed(1)} → ${y2.toFixed(1)}`)
  }

  // 4) 화살이 창에 박힘
  {
    const w = new World()
    w.setDisplays([screen])
    w.setCanMoveWindows(true, 0)
    w.syncWindows([{ id: 1, pid: 1, x: 600, y: 300, w: 400, h: 300 }], 0)
    w.spawnItem('arrow', 300, 420, 3800, -100)
    for (let i = 0; i < 60; i++) w.step(0)
    const f = w.frame()
    ok('화살이 창에 박힘', (f.items[5] & 1) === 1, `깃발 ${f.items[5]} 위치 ${f.items[2].toFixed(0)},${f.items[3].toFixed(0)} 창 x ${w.windowRects()[0].x.toFixed(0)}`)
  }

  // 5) 코스 코드 주고받기
  {
    const work = { x: 0, y: 25, w: 1440, h: 815 }
    let allOk = true
    let longest = 0
    for (const ch of CHALLENGES) {
      const w = new World()
      w.setDisplays([screen])
      importCourse(w, ch.course, work)
      const code = encodeCourse(exportCourse(w, work))
      longest = Math.max(longest, code.length)
      const back = decodeCourse(`친구가 보낸 코드 ${code} 끝`)
      const w2 = new World()
      w2.setDisplays([screen])
      if (back) importCourse(w2, back, work)
      const a = w.scene()
      const b = w2.scene()
      const same = !!back && a.portals.length === b.portals.length && a.structs.length === b.structs.length && a.strokes.length === b.strokes.length && a.portals.every((p, i) => Math.abs(p.x - b.portals[i].x) < 1 && (p.pair === null) === (b.portals[i].pair === null))
      if (!same) allOk = false
    }
    ok('도전 코스 8개 코드로 주고받기', allOk, `가장 긴 코드 ${longest}자`)
    ok('엉터리 코드는 거절', decodeCourse('WH1.abc') === null && decodeCourse('hello') === null)
  }

  for (const [name, pass, info] of results) console.log(`${pass ? '✓' : '✗'} ${name}${info ? ` — ${info}` : ''}`)
  if (results.some((r) => !r[1])) process.exit(1)
}
void main()
