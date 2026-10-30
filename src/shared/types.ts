import type { ItemKind, Material, StructureKind } from './defs'

// 메인 ↔ 오버레이 렌더러가 주고받는 모양. 좌표는 모두 화면 좌표(DIP, 주 화면 왼쪽 위 0,0, 아래로 +y)

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface OverlayInit {
  /** 이 오버레이가 덮는 화면의 화면 좌표 */
  bounds: Rect
  /** 1도트 = 몇 px */
  dot: number
  debug: boolean
  /** 헤드리스 캡처: 바탕화면·창을 흉내 낸 배경을 깐다 */
  backdrop: boolean
}

export interface OverlayApi {
  platform: string
  onInit(cb: (v: OverlayInit) => void): void
  onFrame(cb: (v: FramePacket) => void): void
  onScene(cb: (v: ScenePacket) => void): void
  onSettings(cb: (v: Settings) => void): void
  /** 휠로 고른 것 돌리기 (도구를 쓰는 동안만 옴) */
  wheel(dy: number): void
  ready(): void
}

// ───────── 그림 프레임 (메인 → 오버레이, 60Hz) ─────────


export type Fx =
  | { t: 'hit'; x: number; y: number; v: number; k: ItemKind; m: Material | 'window' | 'wall' }
  | { t: 'warp'; x: number; y: number; c: number }
  | { t: 'stick'; x: number; y: number }
  | { t: 'kick'; x: number; y: number; k: StructureKind }
  | { t: 'bell'; x: number; y: number }
  | { t: 'splat'; x: number; y: number }
  | { t: 'boom'; x: number; y: number }
  | { t: 'goal'; x: number; y: number; k: StructureKind; bounces: number; portals: number; attempts: number; item: ItemKind }
  | { t: 'cursor-warp'; x: number; y: number; c: number }

export interface StructView {
  id: number
  k: StructureKind
  x: number
  y: number
  a: number
  s: number
  /** 따로 움직이는 부분 (시소 판·풍차 날개) */
  m?: { x: number; y: number; a: number }
}

export interface PortalView {
  id: number
  pair: number | null
  x: number
  y: number
  a: number
  c: number
}

export interface StrokeView {
  id: number
  mat: Material
  pts: number[]
}

export interface Frame {
  /** [id, 종류 번호(ITEMS 순서), x, y, 각도, 깃발(1 박힘 · 2 잡힘 · 4 깜빡)] × n */
  items: number[]
  structs: StructView[]
  portals: PortalView[]
  fx: Fx[]
  /** 가장 빠른 장난감 속도계 */
  speed: { x: number; y: number; kmh: number } | null
}

export type Tool =
  | { t: 'none' }
  | { t: 'hand' }
  | { t: 'erase' }
  | { t: 'portal' }
  | { t: 'struct'; kind: StructureKind }
  | { t: 'draw'; mat: Material }
  | { t: 'item'; kind: ItemKind }

/** 도구 상태 (그림용) */
export interface ToolView {
  tool: Tool
  cursor: { x: number; y: number }
  /** 새총: 당긴 자리 → 커서, 미리보기 궤적 (NaN 쌍 = 웜홀로 끊김) */
  aim: { x: number; y: number; power: number; pts: number[] } | null
  /** 그리는 중인 선 */
  stroke: number[] | null
  /** 마우스가 올라간 것 */
  hover: { t: 'item' | 'struct' | 'portal' | 'stroke'; id: number } | null
  /** 손 도구로 고른 구조물·웜홀 + 회전 손잡이 */
  sel: { t: 'struct' | 'portal'; id: number; hx: number; hy: number } | null
  /** 짝을 기다리는 웜홀이 있음 */
  pending: boolean
  /** 손 도구로 창 끌기 대상(나중) */
  erase: number
}

export interface FramePacket extends Frame {
  ui: ToolView | null
  /** 디버그: 창 상자 */
  wins?: { id: number; x: number; y: number; w: number; h: number; mode: string }[]
}

export interface ScenePacket {
  strokes: StrokeView[]
}

// ───────── 설정 ─────────

export type PreviewMode = 'full' | 'short' | 'off'

export interface Settings {
  /** 1도트 = px */
  dot: number
  sound: boolean
  volume: number
  /** 커서도 웜홀을 통과 */
  cursorWarp: boolean
  /** 새총 궤적 미리보기 */
  preview: PreviewMode
  /** 창 밀기 (손쉬운 사용 권한 필요) */
  pushWindows: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  dot: 3,
  sound: true,
  volume: 0.6,
  cursorWarp: true,
  preview: 'full',
  pushWindows: true
}

/** 메인 → 공구함 */
export interface ToolboxState {
  tool: Tool
  settings: Settings
  /** 손쉬운 사용 권한 (맥). 윈도우는 항상 true */
  canMove: boolean
  platform: string
  counts: { items: number; structs: number; strokes: number; portals: number; moved: number }
  sel: { t: 'struct' | 'portal'; id: number; pinned?: boolean; s?: number } | null
  canRelaunch: boolean
  version: string
}

export type ToolboxAction =
  | { t: 'tool'; tool: Tool }
  | { t: 'settings'; patch: Partial<Settings> }
  | { t: 'clear-items' }
  | { t: 'clear-all' }
  | { t: 'restore-windows' }
  | { t: 'undo' }
  | { t: 'relaunch' }
  | { t: 'sel-scale'; dir: 1 | -1 }
  | { t: 'sel-pin' }
  | { t: 'sel-delete' }
  | { t: 'open-accessibility' }
  | { t: 'hide' }
  | { t: 'quit' }

export interface ToolboxApi {
  platform: string
  onState(cb: (s: ToolboxState) => void): void
  act(a: ToolboxAction): void
  ready(): void
}
