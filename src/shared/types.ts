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
  /** 실화면 녹화 중 (도구 표시를 숨긴다) */
  onRecording(cb: (on: boolean) => void): void
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
  | { t: 'goal'; x: number; y: number; k: StructureKind; bounces: number; portals: number; attempts: number; item: ItemKind; id: number; age: number }
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
  /** 골인하면 도트 영상 자동 저장 */
  autoClip: boolean
  /** 실화면 녹화는 골인 2초 뒤 자동으로 멈추고 저장 */
  stopOnGoal: boolean
  /** 모두 숨기기 단축키 (Electron accelerator, 예: Control+Alt+H) */
  hideKey: string
}

export const DEFAULT_SETTINGS: Settings = {
  dot: 3,
  sound: true,
  volume: 0.6,
  cursorWarp: true,
  preview: 'full',
  pushWindows: true,
  autoClip: true,
  stopOnGoal: true,
  hideKey: 'Control+Alt+H'
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
  /** 잠깐 보여 줄 알림 */
  toast: { text: string; at: number } | null
  /** 지금 깔린 도전 코스 */
  challenge: string | null
  /** 실화면 녹화 중이면 시작 시각 */
  recordingSince: number | null
  /** 도트 영상 만드는 중 */
  rendering: boolean
  /** 맥 화면 기록 권한 (granted · denied · not-determined …) */
  screenPerm: string
  lastSaved: string | null
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
  | { t: 'course-copy' }
  | { t: 'course-paste' }
  | { t: 'course-load'; id: string }
  | { t: 'record' }
  | { t: 'hide-all' }
  | { t: 'more-apps' }
  | { t: 'instagram' }
  | { t: 'open-videos' }
  | { t: 'open-screen-permission' }
  | { t: 'hide' }
  | { t: 'quit' }

export interface ToolboxApi {
  platform: string
  onState(cb: (s: ToolboxState) => void): void
  act(a: ToolboxAction): void
  ready(): void
}

// ───────── 영상 (스튜디오 창) ─────────

/** 기록된 한 프레임 (t = 밀리초) */
export interface LogFrame {
  t: number
  f: FramePacket
}

/** 도트 영상으로 다시 그릴 구간 */
export interface Clip {
  id: string
  frames: LogFrame[]
  /** 그 구간에 그려져 있던 선 (바뀐 때마다) */
  strokes: { t: number; strokes: StrokeView[] }[]
  /** 그림을 그릴 전체 영역 (구간 안의 모든 것) */
  view: Rect
  /** 카메라가 따라갈 장난감 (없으면 움직이는 것 가운데) */
  follow: number | null
  /** 골인 자리 */
  goal: { x: number; y: number } | null
  /** 골인 순간 (없으면 슬로모션 없음) */
  goalAt: number | null
  dot: number
  sound: boolean
}

export interface LiveStart {
  id: string
  sourceId: string
  /** 녹화하는 화면 (화면 좌표) */
  bounds: Rect
  sound: boolean
}

export interface StudioDone {
  id: string
  kind: 'dot' | 'screen'
  data: Uint8Array | null
  ext: 'mp4' | 'webm'
  error?: string
}

export interface StudioApi {
  onClip(cb: (c: Clip) => void): void
  onLiveStart(cb: (s: LiveStart) => void): void
  onLiveFrame(cb: (f: FramePacket) => void): void
  onLiveStop(cb: () => void): void
  done(d: StudioDone): void
  ready(): void
}

/** 개발자의 다른 앱 (비둘기 모니터·월급루팡 낚시터와 같은 주소) */
export const MORE_APPS_URL = 'https://easyticket.co.kr/apps/'
export const INSTAGRAM_URL = 'https://www.instagram.com/easyticket.co.kr/'
export const INSTAGRAM_HANDLE = '@easyticket.co.kr'

/** 단축키를 보기 좋게 (맥: ⌃⌥⇧⌘ 기호, 윈도우: Ctrl+Alt+…) */
export function keyLabel(key: string, platform: string): string {
  if (platform !== 'darwin') return key.replace(/Control/g, 'Ctrl').replace(/Command/g, 'Win')
  return key.replace(/Control\+/g, '⌃').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧').replace(/Command\+/g, '⌘')
}

/** 키 입력 → Electron 단축키 문자열. 수식키 없는 일반 키(F1~F24 빼고)나 수식키만 누른 건 null */
export function acceleratorOf(e: { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }, platform: string): string | null {
  let key: string | null = null
  const c = e.code
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3)
  else if (/^Digit[0-9]$/.test(c)) key = c.slice(5)
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) key = c
  else if (/^Numpad[0-9]$/.test(c)) key = 'num' + c.slice(6)
  else if (c === 'Space') key = 'Space'
  else if (c === 'Backquote') key = '`'
  if (!key) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Control')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push(platform === 'darwin' ? 'Command' : 'Super')
  if (!mods.length && !/^F\d+$/.test(key)) return null
  return [...mods, key].join('+')
}
