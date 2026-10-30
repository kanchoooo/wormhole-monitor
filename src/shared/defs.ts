// 장난감·구조물·재질 정의. 물리(메인)와 그림(오버레이)·공구함이 같이 쓴다.
// 길이는 px(화면 좌표), 각도는 라디안, 속도는 px/초.

// ───────── 던지고 쏘는 것 ─────────

export type ItemKind = 'marble' | 'steel' | 'pingpong' | 'rubber' | 'bowling' | 'watermelon' | 'arrow' | 'dart' | 'bomb' | 'chunk'

export interface ItemDef {
  kind: ItemKind
  name: string
  /** 공구함 분류 */
  group: 'roll' | 'shoot' | 'none'
  /** 공: 반지름. 막대(화살·다트): 반 길이 */
  r: number
  /** 막대 두께의 반 */
  thick?: number
  shape: 'ball' | 'stick'
  /** 넓이당 밀도 (공기·물 기준 없음, 서로 비교용) */
  density: number
  restitution: number
  friction: number
  /** 새총으로 꽉 당겼을 때 나가는 속도 */
  launch: number
  /** 창·나무에 박힌다 */
  sticks?: boolean
}

export const ITEMS: Record<ItemKind, ItemDef> = {
  marble: { kind: 'marble', name: '유리구슬', group: 'roll', r: 7, shape: 'ball', density: 2.5, restitution: 0.55, friction: 0.3, launch: 3000 },
  steel: { kind: 'steel', name: '쇠구슬', group: 'roll', r: 8, shape: 'ball', density: 8, restitution: 0.35, friction: 0.3, launch: 2800 },
  pingpong: { kind: 'pingpong', name: '탁구공', group: 'roll', r: 9, shape: 'ball', density: 0.25, restitution: 0.88, friction: 0.4, launch: 2600 },
  rubber: { kind: 'rubber', name: '고무공', group: 'roll', r: 14, shape: 'ball', density: 1, restitution: 0.9, friction: 0.8, launch: 2800 },
  bowling: { kind: 'bowling', name: '볼링공', group: 'roll', r: 22, shape: 'ball', density: 7, restitution: 0.08, friction: 0.5, launch: 2000 },
  watermelon: { kind: 'watermelon', name: '수박', group: 'roll', r: 20, shape: 'ball', density: 1.2, restitution: 0.2, friction: 0.6, launch: 2200 },
  arrow: { kind: 'arrow', name: '화살', group: 'shoot', r: 24, thick: 2, shape: 'stick', density: 3, restitution: 0.1, friction: 0.5, launch: 4200, sticks: true },
  dart: { kind: 'dart', name: '다트', group: 'shoot', r: 13, thick: 2, shape: 'stick', density: 4, restitution: 0.1, friction: 0.5, launch: 3600, sticks: true },
  bomb: { kind: 'bomb', name: '폭탄', group: 'shoot', r: 12, shape: 'ball', density: 3, restitution: 0.3, friction: 0.6, launch: 2400 },
  chunk: { kind: 'chunk', name: '수박 조각', group: 'none', r: 6, shape: 'ball', density: 1, restitution: 0.2, friction: 0.8, launch: 0 }
}

export const ITEM_KINDS = Object.keys(ITEMS) as ItemKind[]

// ───────── 재질 (그린 선·구조물) ─────────

export type Material = 'wood' | 'rubber' | 'ice' | 'glue' | 'metal'

export interface MaterialDef {
  name: string
  friction: number
  restitution: number
  /** 화면에 그릴 색 */
  color: string
  /** 어두운 테두리 색 */
  edge: string
}

export const MATERIALS: Record<Material, MaterialDef> = {
  wood: { name: '나무', friction: 0.5, restitution: 0.35, color: '#c8874a', edge: '#6b3f1d' },
  rubber: { name: '고무', friction: 0.9, restitution: 0.95, color: '#ff5c8a', edge: '#8c1f44' },
  ice: { name: '얼음', friction: 0, restitution: 0.15, color: '#9fe6ff', edge: '#2f7fa3' },
  glue: { name: '끈끈이', friction: 2, restitution: 0, color: '#b6e04a', edge: '#4e6b12' },
  metal: { name: '쇠', friction: 0.3, restitution: 0.5, color: '#a9b6c2', edge: '#4b5560' }
}

/** 공구함에서 그릴 수 있는 재질 */
export const DRAW_MATERIALS: Material[] = ['wood', 'rubber', 'ice', 'glue']

// ───────── 구조물 ─────────

export type StructureKind = 'plank' | 'bumper' | 'spring' | 'funnel' | 'cup' | 'bucket' | 'hoop' | 'seesaw' | 'windmill' | 'conveyor' | 'bell' | 'pegs'

/** 구조물의 조각 (구조물 중심 기준 좌표, 회전·크기 적용 전) */
export type Part =
  | { t: 'box'; x: number; y: number; hw: number; hh: number; a?: number; mat?: Material }
  | { t: 'ball'; x: number; y: number; r: number; mat?: Material }

export interface StructureDef {
  kind: StructureKind
  name: string
  mat: Material
  parts: Part[]
  /** 골인 판정 상자 (컵·양동이·골대) */
  goal?: { x: number; y: number; hw: number; hh: number; mode: 'rest' | 'through' }
  /** 닿으면 밀어내는 속도 (범퍼: 바깥쪽, 스프링: 위쪽) */
  kick?: { mode: 'out' | 'up'; speed: number }
  /** 따로 움직이는 몸체 (시소 판·풍차 날개) */
  moving?: { parts: Part[]; mode: 'pivot' | 'spin'; spin?: number }
  /** 컨베이어: 표면 속도 (구조물 +x 방향) */
  belt?: number
  /** 맞으면 소리 */
  bell?: boolean
}

const deg = (d: number): number => (d * Math.PI) / 180

function pegs(): Part[] {
  const out: Part[] = []
  for (let row = 0; row < 4; row++) {
    const cols = row % 2 ? 4 : 5
    for (let c = 0; c < cols; c++) out.push({ t: 'ball', x: (c - (cols - 1) / 2) * 30, y: (row - 1.5) * 26, r: 3, mat: 'metal' })
  }
  return out
}

export const STRUCTURES: Record<StructureKind, StructureDef> = {
  plank: { kind: 'plank', name: '판자', mat: 'wood', parts: [{ t: 'box', x: 0, y: 0, hw: 70, hh: 5 }] },
  bumper: { kind: 'bumper', name: '범퍼', mat: 'rubber', parts: [{ t: 'ball', x: 0, y: 0, r: 18 }], kick: { mode: 'out', speed: 900 } },
  spring: {
    kind: 'spring',
    name: '스프링',
    mat: 'metal',
    parts: [
      { t: 'box', x: 0, y: -6, hw: 26, hh: 5 },
      { t: 'box', x: 0, y: 10, hw: 22, hh: 4 }
    ],
    kick: { mode: 'up', speed: 1500 }
  },
  funnel: {
    kind: 'funnel',
    name: '깔때기',
    mat: 'wood',
    parts: [
      { t: 'box', x: -34, y: -12, hw: 32, hh: 4, a: deg(38) },
      { t: 'box', x: 34, y: -12, hw: 32, hh: 4, a: deg(-38) }
    ]
  },
  cup: {
    kind: 'cup',
    name: '컵',
    mat: 'wood',
    parts: [
      { t: 'box', x: 0, y: 30, hw: 34, hh: 6 },
      { t: 'box', x: -28, y: 0, hw: 6, hh: 34 },
      { t: 'box', x: 28, y: 0, hw: 6, hh: 34 }
    ],
    goal: { x: 0, y: 8, hw: 21, hh: 20, mode: 'rest' }
  },
  bucket: {
    kind: 'bucket',
    name: '양동이',
    mat: 'metal',
    parts: [
      { t: 'box', x: 0, y: 36, hw: 36, hh: 4 },
      { t: 'box', x: -40, y: 0, hw: 4, hh: 38, a: deg(-7) },
      { t: 'box', x: 40, y: 0, hw: 4, hh: 38, a: deg(7) }
    ],
    goal: { x: 0, y: 14, hw: 32, hh: 20, mode: 'rest' }
  },
  hoop: {
    kind: 'hoop',
    name: '농구 골대',
    mat: 'metal',
    parts: [
      { t: 'box', x: 34, y: -24, hw: 4, hh: 38, mat: 'wood' },
      { t: 'ball', x: -24, y: 0, r: 3 },
      { t: 'box', x: 27, y: 0, hw: 4, hh: 2 }
    ],
    goal: { x: 2, y: 16, hw: 18, hh: 8, mode: 'through' }
  },
  seesaw: {
    kind: 'seesaw',
    name: '시소',
    mat: 'wood',
    parts: [{ t: 'box', x: 0, y: 14, hw: 8, hh: 10 }],
    moving: { parts: [{ t: 'box', x: 0, y: 0, hw: 80, hh: 4 }], mode: 'pivot' }
  },
  windmill: {
    kind: 'windmill',
    name: '풍차',
    mat: 'wood',
    parts: [{ t: 'ball', x: 0, y: 0, r: 7, mat: 'metal' }],
    moving: {
      parts: [
        { t: 'box', x: 0, y: 0, hw: 46, hh: 4 },
        { t: 'box', x: 0, y: 0, hw: 4, hh: 46 }
      ],
      mode: 'spin',
      spin: 1.6
    }
  },
  conveyor: { kind: 'conveyor', name: '컨베이어', mat: 'rubber', parts: [{ t: 'box', x: 0, y: 0, hw: 70, hh: 7 }], belt: 260 },
  bell: { kind: 'bell', name: '종', mat: 'metal', parts: [{ t: 'ball', x: 0, y: 0, r: 14 }], bell: true },
  pegs: { kind: 'pegs', name: '핀 판', mat: 'metal', parts: pegs() }
}

export const STRUCTURE_KINDS = Object.keys(STRUCTURES) as StructureKind[]

// ───────── 웜홀 ─────────

export const PORTAL_R = 34

/** 웜홀 쌍 색 (쌍마다 돌아가며) */
export const PORTAL_COLORS: [string, string][] = [
  ['#b06cff', '#5cecdc'],
  ['#ff9a3c', '#ffd23f'],
  ['#ff5c8a', '#ffb3c8'],
  ['#3cc8ff', '#c8f4ff'],
  ['#6fe08c', '#e8ff7a'],
  ['#ff4d4d', '#ffa07a']
]
