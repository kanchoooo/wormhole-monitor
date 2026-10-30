// 코스 공유 코드: 장면 → 작업 영역 비율 좌표 JSON → 압축 → "WH1." + base64url
import { deflateRawSync, inflateRawSync } from 'zlib'
import { MATERIALS, STRUCTURES } from '@shared/defs'
import type { Course } from '@shared/courses'
import type { Rect } from '@shared/types'
import type { World } from './engine/world'

const PREFIX = 'WH1.'
const r4 = (v: number): number => Math.round(v * 10000) / 10000

export function exportCourse(world: World, work: Rect): Course {
  const sc = world.scene()
  const nx = (x: number): number => r4((x - work.x) / work.w)
  const ny = (y: number): number => r4((y - work.y) / work.h)
  return {
    v: 1,
    portals: sc.portals.map((p) => [nx(p.x), ny(p.y), r4(p.a)]),
    structs: sc.structs.map((s) => [s.kind, nx(s.x), ny(s.y), r4(s.a), s.s, s.pinned]),
    strokes: sc.strokes.map((s) => {
      const pts: number[] = []
      for (let i = 0; i < s.pts.length; i += 2) pts.push(nx(s.pts[i]), ny(s.pts[i + 1]))
      return [s.mat, ...pts]
    })
  }
}

/** 장면을 비우고 코스를 깐다 */
export function importCourse(world: World, c: Course, work: Rect): void {
  world.clearScene()
  const X = (v: number): number => work.x + v * work.w
  const Y = (v: number): number => work.y + v * work.h
  for (const [x, y, a] of c.portals) world.addPortal(X(x), Y(y), a)
  for (const [k, x, y, a, s, pinned] of c.structs) if (k in STRUCTURES) world.addStructure(k, X(x), Y(y), a, s, pinned)
  for (const [mat, ...pts] of c.strokes) {
    if (!(mat in MATERIALS)) continue
    world.addStroke(
      mat,
      pts.map((v, i) => (i % 2 ? Y(v) : X(v)))
    )
  }
}

export function encodeCourse(c: Course): string {
  return PREFIX + deflateRawSync(Buffer.from(JSON.stringify(c))).toString('base64url')
}

/** 잘못된 코드면 null */
export function decodeCourse(text: string): Course | null {
  const m = /WH1\.([A-Za-z0-9_-]+)/.exec(text)
  if (!m) return null
  try {
    const c = JSON.parse(inflateRawSync(Buffer.from(m[1], 'base64url')).toString('utf8')) as Course
    if (c.v !== 1 || !Array.isArray(c.portals) || !Array.isArray(c.structs) || !Array.isArray(c.strokes)) return null
    const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 10
    if (c.portals.length > 200 || c.structs.length > 300 || c.strokes.length > 500) return null
    if (!c.portals.every((p) => p.length === 3 && p.every(num))) return null
    if (!c.structs.every((s) => s.length === 6 && typeof s[0] === 'string' && [1, 2, 3, 4].every((i) => num(s[i])) && typeof s[5] === 'boolean')) return null
    if (!c.strokes.every((s) => typeof s[0] === 'string' && s.length % 2 === 1 && s.length <= 4001 && s.slice(1).every(num))) return null
    return c
  } catch {
    return null
  }
}
