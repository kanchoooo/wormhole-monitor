// 코스: 웜홀·구조물·그린 선 묶음. 화면 크기가 달라도 맞도록 위치는 작업 영역 비율(0~1)로 적는다.
// 공유 코드는 메인이 압축해서 "WH1." + base64url 로 만든다 (main/courses.ts).
import type { Material, StructureKind } from './defs'

export interface Course {
  v: 1
  name?: string
  /** [x, y, 각도] */
  portals: [number, number, number][]
  /** [종류, x, y, 각도, 크기, 고정] */
  structs: [StructureKind, number, number, number, number, boolean][]
  /** [재질, x0, y0, x1, y1, …] */
  strokes: [Material, ...number[]][]
}

export interface Challenge {
  id: string
  name: string
  hint: string
  course: Course
}

const D = Math.PI / 180
const DOWN = 90 * D
const UP = -90 * D

/** 처음부터 들어 있는 도전 코스 (16:10 화면 기준으로 짰지만 비율이라 어디서든 됨) */
export const CHALLENGES: Challenge[] = [
  {
    id: 'first',
    name: '첫 골인',
    hint: '판자 위에 구슬을 떨어뜨려 컵에 넣어 보세요',
    course: {
      v: 1,
      portals: [],
      structs: [
        ['plank', 0.42, 0.42, 20 * D, 1.3, true],
        ['plank', 0.6, 0.62, -15 * D, 1, true],
        ['cup', 0.5, 0.86, 0, 1, true]
      ],
      strokes: []
    }
  },
  {
    id: 'wormhole',
    name: '웜홀 한 번',
    hint: '컵은 닫힌 상자 안에 있어요. 웜홀로만 들어갈 수 있어요',
    course: {
      v: 1,
      portals: [
        [0.2, 0.3, DOWN],
        [0.78, 0.66, DOWN]
      ],
      structs: [['cup', 0.78, 0.86, 0, 1, true]],
      strokes: [['wood', 0.7, 0.95, 0.7, 0.55, 0.86, 0.55, 0.86, 0.95]]
    }
  },
  {
    id: 'pinball',
    name: '범퍼 핀볼',
    hint: '범퍼에 튕겨서 왼쪽 아래 양동이로',
    course: {
      v: 1,
      portals: [],
      structs: [
        ['bumper', 0.35, 0.35, 0, 1, true],
        ['bumper', 0.5, 0.48, 0, 1, true],
        ['bumper', 0.65, 0.35, 0, 1, true],
        ['bumper', 0.42, 0.62, 0, 0.8, true],
        ['bumper', 0.58, 0.62, 0, 0.8, true],
        ['bucket', 0.15, 0.86, 0, 1, true]
      ],
      strokes: [['rubber', 0.3, 0.8, 0.5, 0.92, 0.7, 0.8]]
    }
  },
  {
    id: 'plinko',
    name: '플링코',
    hint: '핀 판 위에서 떨어뜨려 가운데 컵에 넣기',
    course: {
      v: 1,
      portals: [],
      structs: [
        ['pegs', 0.42, 0.35, 0, 1.3, true],
        ['pegs', 0.58, 0.35, 0, 1.3, true],
        ['pegs', 0.5, 0.55, 0, 1.3, true],
        ['funnel', 0.3, 0.75, 0, 1, true],
        ['cup', 0.5, 0.86, 0, 1, true],
        ['funnel', 0.7, 0.75, 0, 1, true]
      ],
      strokes: []
    }
  },
  {
    id: 'hoop',
    name: '농구',
    hint: '왼쪽에서 당겨 쏴서 골대에 넣기 (화살·다트는 안 돼요)',
    course: {
      v: 1,
      portals: [],
      structs: [
        ['hoop', 0.8, 0.4, 0, 1.2, true],
        ['spring', 0.2, 0.85, 0, 1, true]
      ],
      strokes: []
    }
  },
  {
    id: 'loop',
    name: '무한 낙하 탈출',
    hint: '빙글빙글 떨어지는 구슬을 옆으로 빼내 컵으로',
    course: {
      v: 1,
      portals: [
        [0.3, 0.88, UP],
        [0.3, 0.12, DOWN]
      ],
      structs: [
        ['cup', 0.75, 0.86, 0, 1, true],
        ['plank', 0.55, 0.6, 15 * D, 1.2, true]
      ],
      strokes: []
    }
  },
  {
    id: 'conveyor',
    name: '택배 배달',
    hint: '컨베이어에 올려서 깔때기를 지나 컵까지',
    course: {
      v: 1,
      portals: [],
      structs: [
        ['conveyor', 0.35, 0.4, 0, 1.4, true],
        ['funnel', 0.58, 0.55, 0, 1, true],
        ['plank', 0.62, 0.72, 25 * D, 1, true],
        ['cup', 0.72, 0.86, 0, 1, true]
      ],
      strokes: []
    }
  },
  {
    id: 'combo',
    name: '웜홀 콤보',
    hint: '웜홀 두 쌍을 모두 지나서 컵에 (튕김·웜홀 수가 같이 찍혀요)',
    course: {
      v: 1,
      portals: [
        [0.15, 0.25, 0],
        [0.45, 0.15, DOWN],
        [0.45, 0.6, 0],
        [0.85, 0.3, DOWN]
      ],
      structs: [
        ['windmill', 0.65, 0.55, 0, 1, true],
        ['bell', 0.3, 0.5, 0, 1, true],
        ['cup', 0.85, 0.86, 0, 1, true]
      ],
      strokes: [['ice', 0.55, 0.75, 0.75, 0.8]]
    }
  }
]
