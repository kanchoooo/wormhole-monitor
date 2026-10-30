import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { DEFAULT_SETTINGS, type PreviewMode, type Settings } from '@shared/types'

interface Persisted {
  settings: Settings
  /** 처음 실행 안내를 봤나 */
  onboarded: boolean
}

/** userData/state.json 에 저장하는 아주 작은 저장소 */
export class Store {
  private file = join(app.getPath('userData'), 'state.json')
  private timer: NodeJS.Timeout | null = null
  state: Persisted

  constructor() {
    this.state = this.load()
  }

  private load(): Persisted {
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Persisted>
        return { settings: sanitize({ ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) }), onboarded: !!raw.onboarded }
      }
    } catch (err) {
      console.error('[store] 읽기 실패, 처음부터', err)
    }
    return { settings: { ...DEFAULT_SETTINGS }, onboarded: false }
  }

  private saveSoon(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      try {
        mkdirSync(dirname(this.file), { recursive: true })
        writeFileSync(this.file + '.tmp', JSON.stringify(this.state, null, 2))
        renameSync(this.file + '.tmp', this.file)
      } catch (err) {
        console.error('[store] 저장 실패', err)
      }
    }, 300)
  }

  get settings(): Settings {
    return this.state.settings
  }

  setSettings(patch: Partial<Settings>): void {
    this.state.settings = sanitize({ ...this.state.settings, ...patch })
    this.saveSoon()
  }

  setOnboarded(): void {
    this.state.onboarded = true
    this.saveSoon()
  }
}

function sanitize(s: Settings): Settings {
  const preview: PreviewMode[] = ['full', 'short', 'off']
  return {
    dot: [2, 3, 4].includes(s.dot) ? s.dot : DEFAULT_SETTINGS.dot,
    sound: !!s.sound,
    volume: Math.max(0, Math.min(1, Number(s.volume) || 0)),
    cursorWarp: !!s.cursorWarp,
    preview: preview.includes(s.preview) ? s.preview : DEFAULT_SETTINGS.preview,
    pushWindows: !!s.pushWindows
  }
}
