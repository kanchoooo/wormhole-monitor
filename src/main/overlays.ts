import { BrowserWindow, ipcMain, screen, type Display, type IpcMainEvent } from 'electron'
import type { OverlayInit, Rect } from '@shared/types'
import { env, loadRenderer, preloadPath } from './env'

/**
 * 디스플레이마다 하나씩 띄우는 투명 전체화면 창. 그림만 그린다 (물리·입력은 메인이 한다).
 * 평소에는 클릭이 아래 앱으로 통과하고, 도구를 쓰는 동안만 클릭을 막는다(capture).
 */
interface Item {
  id: number
  display: Display
  win: BrowserWindow
  ready: boolean
  nativeId: number
}

export interface HeadlessOpts {
  size: { width: number; height: number }
}

export class Overlays {
  private items = new Map<number, Item>()
  private capturing = false
  private visible = false
  /** 창 목록에서 빼야 하는 우리 창 (맥: CGWindowID, 윈도우: HWND) */
  readonly exclude = new Set<number>()
  onReady: ((displayId: number) => void) | null = null

  constructor(
    private dot: () => number,
    private headless: HeadlessOpts | null = null
  ) {
    ipcMain.on('overlay:ready', (e) => {
      const it = this.itemOf(e)
      if (!it) return
      it.ready = true
      this.sendInit(it)
      this.onReady?.(it.id)
    })
    if (!headless) {
      screen.on('display-added', () => this.sync())
      screen.on('display-removed', () => this.sync())
      screen.on('display-metrics-changed', () => this.sync())
    }
  }

  private itemOf(e: IpcMainEvent): Item | undefined {
    for (const it of this.items.values()) if (!it.win.isDestroyed() && it.win.webContents.id === e.sender.id) return it
    return undefined
  }

  displays(): Display[] {
    if (this.headless) {
      const b = { x: 0, y: 0, ...this.headless.size }
      return [{ id: 1, bounds: b, workArea: { ...b, height: b.height - 60 }, size: this.headless.size, workAreaSize: this.headless.size, scaleFactor: 1 } as unknown as Display]
    }
    return screen.getAllDisplays()
  }

  /** 디스플레이 구성에 맞춰 창을 만들고 없앤다 */
  sync(): void {
    const ds = this.displays()
    const ids = new Set(ds.map((d) => d.id))
    for (const [id, it] of this.items) {
      if (!ids.has(id)) {
        if (!it.win.isDestroyed()) it.win.destroy()
        this.items.delete(id)
      }
    }
    for (const d of ds) {
      const it = this.items.get(d.id)
      if (!it) this.create(d)
      else {
        const moved = JSON.stringify(it.display.bounds) !== JSON.stringify(d.bounds)
        it.display = d
        if (moved && !it.win.isDestroyed()) {
          it.win.setBounds(d.bounds)
          this.sendInit(it)
        }
      }
    }
  }

  private create(d: Display): void {
    const isMac = process.platform === 'darwin'
    const b = d.bounds
    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      enableLargerThanScreen: true,
      roundedCorners: false,
      acceptFirstMouse: true,
      ...(isMac ? { type: 'panel' } : { type: 'toolbar' }),
      webPreferences: {
        preload: preloadPath('overlay'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
        offscreen: !!this.headless
      }
    })
    win.setIgnoreMouseEvents(!this.capturing, { forward: true })
    win.setAlwaysOnTop(true, 'screen-saver')
    if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    win.webContents.on('console-message', (e) => {
      if (env.WH_LOG === '1') console.log(`[overlay ${d.id}:${e.level}] ${e.message}`)
    })
    const it: Item = { id: d.id, display: d, win, ready: false, nativeId: nativeWindowId(win) }
    if (it.nativeId) this.exclude.add(it.nativeId)
    win.on('closed', () => {
      this.exclude.delete(it.nativeId)
      if (this.items.get(d.id) === it) this.items.delete(d.id)
    })
    loadRenderer(win, 'overlay', { query: env.WH_DEBUG === '1' || this.headless ? { debug: '1' } : undefined })
    this.items.set(d.id, it)
    if (this.visible) this.showItem(it)
  }

  private sendInit(it: Item): void {
    if (!it.ready || it.win.isDestroyed()) return
    const b = it.display.bounds
    const init: OverlayInit = { bounds: { x: b.x, y: b.y, w: b.width, h: b.height }, dot: this.dot(), debug: env.WH_DEBUG === '1' || !!this.headless }
    it.win.webContents.send('overlay:init', init)
  }

  resendInit(): void {
    for (const it of this.items.values()) this.sendInit(it)
  }

  private showItem(it: Item): void {
    if (it.win.isDestroyed() || it.win.isVisible()) return
    if (!this.headless) {
      it.win.setBounds(it.display.bounds)
      it.win.setAlwaysOnTop(true, 'screen-saver')
    }
    it.win.showInactive()
    if (!this.headless) it.win.moveTop()
  }

  /** 그릴 게 있을 때만 보인다 (없으면 숨겨서 아무 영향이 없게) */
  setVisible(on: boolean): void {
    if (on === this.visible) return
    this.visible = on
    for (const it of this.items.values()) {
      if (on) this.showItem(it)
      else if (!it.win.isDestroyed()) it.win.hide()
    }
  }

  /** 도구를 쓰는 동안 클릭이 아래 앱으로 가지 않게 막는다 */
  setCapture(on: boolean): void {
    if (on === this.capturing) return
    this.capturing = on
    for (const it of this.items.values()) {
      if (it.win.isDestroyed()) continue
      if (on) it.win.setIgnoreMouseEvents(false)
      else it.win.setIgnoreMouseEvents(true, { forward: true })
    }
  }

  /** 화면마다 그 화면 근처 것만 보낸다 */
  each(fn: (bounds: Rect, send: (channel: string, v: unknown) => void) => void): void {
    for (const it of this.items.values()) {
      if (!it.ready || it.win.isDestroyed()) continue
      const b = it.display.bounds
      fn({ x: b.x, y: b.y, w: b.width, h: b.height }, (ch, v) => it.win.webContents.send(ch, v))
    }
  }

  get first(): BrowserWindow | null {
    return [...this.items.values()][0]?.win ?? null
  }

  destroy(): void {
    for (const it of this.items.values()) if (!it.win.isDestroyed()) it.win.destroy()
    this.items.clear()
  }
}

/** 창 목록에서 이 창을 찾기 위한 번호 (맥: CGWindowID, 윈도우: HWND) */
export function nativeWindowId(win: BrowserWindow): number {
  try {
    if (process.platform === 'win32') {
      const h = win.getNativeWindowHandle()
      return Number(h.length >= 8 ? h.readBigUInt64LE(0) : h.readUInt32LE(0))
    }
    const m = /^window:(\d+):/.exec(win.getMediaSourceId())
    return m ? Number(m[1]) : 0
  } catch {
    return 0
  }
}
