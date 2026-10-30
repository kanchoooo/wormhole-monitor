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
}

export interface OverlayApi {
  platform: string
  onInit(cb: (v: OverlayInit) => void): void
  onFrame(cb: (v: unknown) => void): void
  onScene(cb: (v: unknown) => void): void
  ready(): void
}
