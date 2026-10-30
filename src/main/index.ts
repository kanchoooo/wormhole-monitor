import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, Menu, screen, shell, systemPreferences, Tray } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { CHALLENGES } from '@shared/courses'
import type { Rect, Tool, ToolboxAction, ToolboxState } from '@shared/types'
import { decodeCourse, encodeCourse, exportCourse, importCourse } from './courses'
import { Engine } from './engine'
import { initPhysics } from './engine/world'
import { runScript, type Step } from './engine/script'
import { env, loadRenderer, preloadPath } from './env'
import { trayIcon } from './icons'
import { Overlays } from './overlays'
import { Recorder } from './recorder'
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
let recorder: Recorder
let store: Store
let quitting = false
let toolKeys = false
let toast: ToolboxState['toast'] = null
let challenge: string | null = null
const startHidden = process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin)
const TOGGLE_KEY = 'Control+Alt+W'
const RECORD_KEY = 'Control+Alt+R'

// ───────── 공구함 ─────────

function toolboxState(): ToolboxState {
  const w = engine.world
  const sel = engine.tools.sel
  let selView: ToolboxState['sel'] = null
  if (sel?.t === 'struct') {
    const st = w.structure(sel.id)
    if (st) selView = { t: 'struct', id: sel.id, s: st.s, pinned: st.pinned }
  } else if (sel?.t === 'portal' && w.portals.has(sel.id)) selView = { t: 'portal', id: sel.id }
  return {
    tool: engine.tools.tool,
    settings: store.settings,
    canMove: engine.canMove,
    platform: process.platform,
    counts: { items: w.itemCount, structs: w.structCount, strokes: w.strokeViews().length, portals: w.portals.size, moved: w.movedWindows },
    sel: selView,
    canRelaunch: !!engine.tools.lastLaunch,
    version: app.getVersion(),
    toast,
    challenge,
    recordingSince: recorder.live?.since ?? null,
    rendering: recorder.rendering > 0,
    screenPerm: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'granted',
    lastSaved: recorder.lastSaved
  }
}

function say(text: string): void {
  toast = { text, at: Date.now() }
  pushState()
}

/** 코스 좌표 기준: 커서가 있는 화면의 작업 영역 */
function workArea(): Rect {
  const d = headless ? overlays.displays()[0] : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return { x: d.workArea.x, y: d.workArea.y, w: d.workArea.width, h: d.workArea.height }
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
  // 오버레이(screen-saver 단계)보다 한 단계 위 — 도구를 쓰는 동안에도 공구함을 누를 수 있게
  win.setAlwaysOnTop(true, 'screen-saver', 1)
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
  t.moveTop()
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
  if (toolbox?.isVisible()) toolbox.moveTop()
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
      engine.world.clearScene()
      engine.tools.sel = null
      challenge = null
      break
    case 'course-copy': {
      const c = exportCourse(engine.world, workArea())
      if (!c.portals.length && !c.structs.length && !c.strokes.length) {
        say('복사할 코스가 없어요. 웜홀·구조물·선을 먼저 놓아 주세요')
        break
      }
      void clipboard.writeText(`${encodeCourse(c)}\n↑ 웜홀 모니터 코스 코드 — 공구함 › 코스 › 붙여넣기`)
      say('코스 코드를 복사했어요. 친구에게 보내 보세요!')
      break
    }
    case 'course-paste':
      void pasteCourse()
      break
    case 'course-load': {
      const ch = CHALLENGES.find((c) => c.id === a.id)
      if (!ch) break
      engine.tools.cancel()
      engine.tools.sel = null
      importCourse(engine.world, ch.course, workArea())
      challenge = ch.id
      if (engine.tools.tool.t === 'none' || engine.tools.tool.t === 'struct' || engine.tools.tool.t === 'draw') setTool({ t: 'item', kind: ch.id === 'hoop' ? 'rubber' : 'marble' })
      say(`도전: ${ch.name} — ${ch.hint}`)
      break
    }
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
    case 'sel-pin': {
      const sel = engine.tools.sel
      const st = sel?.t === 'struct' ? engine.world.structure(sel.id) : null
      if (sel && st) engine.world.setPinned(sel.id, !st.pinned)
      break
    }
    case 'open-accessibility':
      if (process.platform === 'darwin') {
        // 처음이면 시스템이 묻는 창을 띄우고, 설정 화면도 연다
        systemPreferences.isTrustedAccessibilityClient(true)
        void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
      }
      break
    case 'record':
      void toggleRecord()
      break
    case 'open-videos':
      if (recorder.lastSaved) shell.showItemInFolder(recorder.lastSaved)
      else void shell.openPath(join(app.getPath('videos'), '웜홀 모니터'))
      break
    case 'open-screen-permission':
      void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
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

async function toggleRecord(): Promise<void> {
  if (recorder.live) {
    recorder.stopLive()
    return say('녹화를 멈췄어요. 영상 두 개(화면·도트)를 만드는 중…')
  }
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') {
    return say('화면 기록 권한이 꺼져 있어요. 설정 › 개인정보 보호 › 화면 기록에서 웜홀 모니터를 켜 주세요')
  }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const err = await recorder.startLive(d)
  if (err) return say(err)
  say(store.settings.stopOnGoal ? '🔴 녹화 중 — 골인하면 2초 뒤 저절로 멈춰요' : '🔴 녹화 중 — 다시 누르면 멈춰요')
}

async function pasteCourse(): Promise<void> {
  const c = decodeCourse(await clipboard.readText())
  if (!c) return say('클립보드에 코스 코드(WH1.…)가 없어요')
  engine.tools.cancel()
  engine.tools.sel = null
  importCourse(engine.world, c, workArea())
  challenge = null
  engine.wake()
  say('코스를 불러왔어요')
}

// ───────── 트레이 ─────────

function buildTrayMenu(): void {
  if (!tray) return
  const w = engine.world
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: toolbox?.isVisible() ? '공구함 숨기기' : '공구함 열기', accelerator: TOGGLE_KEY, click: toggleToolbox },
      { label: '손 놓기 (ESC)', enabled: engine.tools.tool.t !== 'none', click: () => setTool({ t: 'none' }) },
      { label: recorder?.live ? '⏹ 녹화 멈추기' : '🎥 실화면 녹화', accelerator: RECORD_KEY, click: () => void toggleRecord() },
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
  // 테스트에서는 절대 진짜 창을 건드리지 않는다 (가짜 창만)
  if (headless) engine.fakeWindows = []
  engine.onChange = () => {
    pushState()
    buildTrayMenu()
  }
  // 공구함 위를 누른 건 도구로 쓰지 않는다
  engine.blocked = (x, y) => {
    if (!toolbox || toolbox.isDestroyed() || !toolbox.isVisible()) return false
    const b = toolbox.getBounds()
    return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height
  }
  recorder = new Recorder(() => store.settings, env.WH_VIDEO_DIR || undefined)
  engine.onGlobalFrame = (f, v, strokes) => recorder.push(f, v, strokes)
  recorder.onChange = () => pushState()
  recorder.onSaved = (files) => say(`🎬 영상 저장: ${files.map((f) => (f.includes('-화면.') ? '화면' : '도트')).join(' · ')} — 정리 › 영상 폴더`)
  recorder.onLive = (on) => {
    overlays.each((_b, send) => send('overlay:recording', on))
    // 실화면 영상에 공구함이 찍히지 않게
    if (toolbox && !toolbox.isDestroyed()) toolbox.setContentProtection(on)
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
      toolbox.setSize(300, Number(env.WH_TOOLBOX_H) || 720)
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
  globalShortcut.register(RECORD_KEY, () => void toggleRecord())
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
  recorder?.destroy()
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('window-all-closed', () => {
  /* 트레이에 남는다 */
})
