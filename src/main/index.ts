import { app, Menu, Tray } from 'electron'
import { env } from './env'
import { trayIcon } from './icons'
import { Overlays } from './overlays'
import { setupUpdater } from './updater'
import { listWindows } from './windows'

if (process.platform === 'win32') app.setAppUserModelId('com.wormholemonitor.app')
if (env.WH_USERDATA) app.setPath('userData', env.WH_USERDATA)
if (!app.requestSingleInstanceLock()) app.quit()

let tray: Tray | null = null
let overlays: Overlays

function buildTrayMenu(): void {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: '웜홀 모니터', enabled: false },
      { type: 'separator' },
      { label: '종료', role: 'quit' }
    ])
  )
}

app.whenReady().then(() => {
  if (env.WH_SELFTEST === '1') {
    const wins = listWindows()
    console.log(`[selftest] 창 ${wins.length}개`, JSON.stringify(wins.slice(0, 3)))
    app.exit(0)
    return
  }
  if (process.platform === 'darwin') app.dock?.hide()
  overlays = new Overlays(() => 3)
  overlays.sync()
  overlays.setVisible(true)
  tray = new Tray(trayIcon())
  tray.setToolTip('웜홀 모니터')
  buildTrayMenu()
  setupUpdater()
})

app.on('window-all-closed', () => {
  /* 트레이에 남는다 */
})
