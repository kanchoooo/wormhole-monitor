import { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, shell, systemPreferences, Tray } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Tool, ToolboxAction, ToolboxState } from '@shared/types'
import { Engine } from './engine'
import { initPhysics } from './engine/world'
import { runScript, type Step } from './engine/script'
import { env, loadRenderer, preloadPath } from './env'
import { trayIcon } from './icons'
import { Overlays } from './overlays'
import { Store } from './store'
import { setupUpdater } from './updater'
import { listWindows } from './windows'
import { getMover } from './windows/move'

if (process.platform === 'win32') app.setAppUserModelId('com.wormholemonitor.app')
const headless = env.WH_HEADLESS === '1'
if (env.WH_USERDATA) app.setPath('userData', env.WH_USERDATA)
else if (headless) app.setPath('userData', join(app.getPath('temp'), 'wormhole-monitor-test'))
if (!headless && !app.requestSingleInstanceLock()) app.quit()

let tray: Tray | null = null
let toolbox: BrowserWindow | null = null
let overlays: Overlays
let engine: Engine
let store: Store
let quitting = false
let toolKeys = false
const startHidden = process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)
const TOGGLE_KEY = 'Control+Alt+W'

// ───────── 공구함 ─────────

function toolboxState(): ToolboxState {
  const w = engine.world
  const sel = engine.tools.sel
  let selView: ToolboxState['sel'] = null
  if (sel?.t === 'struct') {
    const st = w.structure(sel.id)
    if (st) selView = { t: 'struct', id: sel.id, s: st.s }
  } else if (sel?.t === 'portal' && w.portals.has(sel.id)) selView = { t: 'portal', id: sel.id }
  const f = w.frame()
  return {
    tool: engine.tools.tool,
    settings: store.settings,
    canMove: engine.canMove,
    platform: process.platform,
    counts: { items: w.itemCount, structs: f.structs.length, strokes: w.strokeViews().length, portals: w.portals.size, moved: w.movedWindows },
    sel: selView,
    canRelaunch: !!engine.tools.lastLaunch,
    version: app.getVersion()
  }
}

let pushTimer: NodeJS.Timeout | null = null
function pushState(): void {
  if (pushTimer) return
  pushTimer = setTimeout(() => {
    pushTimer = null
    if (toolbox && !toolbox.isDestroyed()) toolbox.webContents.send('toolbox:state', toolboxState())
  }, 30)
}

function createToolbox(): BrowserWindow {
  const d = screen.getPrimaryDisplay().workArea
  const W = 300
  const H = Math.min(720, d.height - 40)
  const win = new BrowserWindow({
    x: d.x + d.width - W - 24,
    y: d.y + 24,
    width: W,
    height: H,
    minWidth: 260,
    minHeight: 300,
    show: false,
    frame: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#17112c',
    title: '웜홀 모니터',
    webPreferences: { preload: preloadPath('toolbox'), sandbox: true, contextIsolation: true }
  })
  win.setAlwaysOnTop(true, 'floating')
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    hideToolbox()
  })
  loadRenderer(win, 'toolbox')
  return win
}

function showToolbox(): void {
  if (!toolbox || toolbox.isDestroyed()) toolbox = createToolbox()
  const t = toolbox
  if (t.webContents.isLoading()) t.once('ready-to-show', () => t.show())
  else t.show()
  pushState()
}

function hideToolbox(): void {
  setTool({ t: 'none' })
  toolbox?.hide()
}

function toggleToolbox(): void {
  if (toolbox?.isVisible()) hideToolbox()
  else showToolbox()
}

// ───────── 도구 ─────────

function setTool(t: Tool): void {
  engine.setTool(t)
  // 도구를 쓰는 동안만 ESC·되돌리기 단축키를 잡는다 (평소엔 다른 앱 키를 건드리지 않게)
  const want = t.t !== 'none'
  if (want && !toolKeys && !headless) {
    toolKeys = true
    globalShortcut.register('Escape', () => setTool({ t: 'none' }))
    globalShortcut.register('CommandOrControl+Z', () => engine.tools.undo())
  } else if (!want && toolKeys) {
    toolKeys = false
    globalShortcut.unregister('Escape')
    globalShortcut.unregister('CommandOrControl+Z')
  }
  pushState()
  buildTrayMenu()
}

function handle(a: ToolboxAction): void {
  switch (a.t) {
    case 'tool':
      setTool(a.tool)
      break
    case 'settings': {
      store.setSettings(a.patch)
      const dotChanged = a.patch.dot !== undefined
      overlays.each((_b, send) => send('overlay:settings', store.settings))
      if (dotChanged) overlays.resendInit()
      break
    }
    case 'clear-items':
      engine.world.clearItems()
      break
    case 'clear-all':
      engine.tools.cancel()
      engine.world.clearItems()
      for (const p of [...engine.world.portals.keys()]) engine.world.removePortal(p)
      for (const s of engine.world.frame().structs) engine.world.removeStructure(s.id)
      for (const s of engine.world.strokeViews()) engine.world.removeStroke(s.id)
      engine.tools.sel = null
      break
    case 'restore-windows':
      engine.restoreWindows()
      break
    case 'undo':
      engine.tools.undo()
      break
    case 'relaunch':
      engine.tools.relaunch()
      break
    case 'sel-scale':
      engine.tools.scaleSelected(a.dir)
      break
    case 'sel-delete':
      engine.tools.deleteSelected()
      break
    case 'sel-pin':
      break
    case 'open-accessibility':
      if (process.platform === 'darwin') {
        // 처음이면 시스템이 묻는 창을 띄우고, 설정 화면도 연다
        systemPreferences.isTrustedAccessibilityClient(true)
        void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
      }
      break
    case 'hide':
      hideToolbox()
      break
    case 'quit':
      quitting = true
      app.quit()
      break
  }
  engine.wake()
  pushState()
}

// ───────── 트레이 ─────────

function buildTrayMenu(): void {
  if (!tray) return
  const w = engine.world
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: toolbox?.isVisible() ? '공구함 숨기기' : '공구함 열기', accelerator: TOGGLE_KEY, click: toggleToolbox },
      { label: '손 놓기 (ESC)', enabled: engine.tools.tool.t !== 'none', click: () => setTool({ t: 'none' }) },
      { type: 'separator' },
      { label: '장난감 치우기', click: () => handle({ t: 'clear-items' }) },
      { label: '전부 치우기', click: () => handle({ t: 'clear-all' }) },
      { label: `창 원위치${w.movedWindows ? ` (${w.movedWindows})` : ''}`, enabled: w.movedWindows > 0, click: () => handle({ t: 'restore-windows' }) },
      { type: 'separator' },
      { label: `웜홀 모니터 v${app.getVersion()}`, enabled: false },
      {
        label: '종료',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

// ───────── 시작 ─────────

app.whenReady().then(async () => {
  if (env.WH_SELFTEST === '1') {
    const wins = listWindows()
    const mover = getMover()
    console.log(`[selftest] 창 ${wins.length}개 · 옮기기 ${mover ? (mover.canMove() ? '가능' : '권한 없음') : '불가'}`, JSON.stringify(wins.slice(0, 3)))
    // WH_SELFTEST_MOVE=pid 면 그 앱의 맨 앞 창을 40px 옮겼다가 되돌린다
    const pid = Number(env.WH_SELFTEST_MOVE)
    const target = pid ? wins.find((w) => w.pid === pid) : undefined
    if (mover && target) {
      const moved = mover.move(target.id, target.pid, target.x + 40, target.y + 40)
      await new Promise((r) => setTimeout(r, 300))
      const after = listWindows().find((w) => w.id === target.id)
      mover.move(target.id, target.pid, target.x, target.y)
      await new Promise((r) => setTimeout(r, 300))
      const back = listWindows().find((w) => w.id === target.id)
      console.log(`[selftest] 옮기기 ${moved ? '성공' : '실패'}: ${target.x},${target.y} → ${after?.x},${after?.y} → 되돌림 ${back?.x},${back?.y}`)
    }
    app.exit(0)
    return
  }
  await initPhysics()
  if (process.platform === 'darwin' && !headless) app.dock?.hide()
  store = new Store()
  overlays = new Overlays(() => store.settings.dot, headless ? { size: { width: 1440, height: 900 } } : null)
  engine = new Engine(overlays, () => store.settings, headless || env.WH_DEBUG === '1')
  engine.onChange = () => {
    pushState()
    buildTrayMenu()
  }
  overlays.onReady = () => {
    overlays.each((_b, send) => send('overlay:settings', store.settings))
    engine.resendScene()
  }
  overlays.sync()
  engine.setDisplays()
  if (!headless) {
    screen.on('display-added', () => engine.setDisplays())
    screen.on('display-removed', () => engine.setDisplays())
    screen.on('display-metrics-changed', () => engine.setDisplays())
  }

  ipcMain.on('toolbox:ready', () => pushState())
  ipcMain.on('toolbox:act', (_e, a: ToolboxAction) => handle(a))
  ipcMain.on('overlay:wheel', (_e, dy: number) => {
    engine.tools.wheel(Number(dy) || 0)
    engine.wake()
  })

  if (headless) {
    // WH_TOOLBOX_SHOT=경로.png → 공구함을 캡처해 저장
    if (env.WH_TOOLBOX_SHOT) {
      toolbox = createToolbox()
      toolbox.webContents.once('did-finish-load', () =>
        setTimeout(async () => {
          const img = await toolbox!.webContents.capturePage()
          writeFileSync(env.WH_TOOLBOX_SHOT!, img.toPNG())
          console.log('[headless] toolbox shot')
        }, 1200)
      )
    }
    startScript()
    return
  }

  tray = new Tray(trayIcon())
  tray.setToolTip('웜홀 모니터')
  tray.on('click', () => (process.platform === 'win32' ? toggleToolbox() : undefined))
  buildTrayMenu()
  globalShortcut.register(TOGGLE_KEY, toggleToolbox)
  if (!startHidden) showToolbox()
  setupUpdater()
})

function startScript(): void {
  const file = env.WH_SCRIPT
  const shotDir = env.WH_SHOT_DIR ?? join(app.getPath('temp'), 'wormhole-shots')
  mkdirSync(shotDir, { recursive: true })
  if (!file) {
    console.log('[headless] WH_SCRIPT 가 없어요')
    return
  }
  const steps = JSON.parse(readFileSync(file, 'utf8')) as Step[]
  // 오버레이가 준비된 뒤 시작
  const start = (): void =>
    runScript(
      steps,
      engine,
      shotDir,
      async () => {
        const w = overlays.first
        if (!w) return null
        const img = await w.webContents.capturePage()
        return img.toPNG()
      },
      () => {
        quitting = true
        app.exit(0)
      }
    )
  setTimeout(start, 1500)
}

app.on('before-quit', () => {
  quitting = true
  engine?.destroy()
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  /* 트레이에 남는다 */
})
