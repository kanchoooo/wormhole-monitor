import { contextBridge, ipcRenderer } from 'electron'
import type { StudioApi } from '@shared/types'

function on<T>(channel: string, cb: (v: T) => void): void {
  ipcRenderer.on(channel, (_e, v: T) => cb(v))
}

const api: StudioApi = {
  onClip: (cb) => on('studio:clip', cb),
  onLiveStart: (cb) => on('studio:live-start', cb),
  onLiveFrame: (cb) => on('studio:live-frame', cb),
  onLiveStop: (cb) => on('studio:live-stop', () => cb()),
  done: (d) => ipcRenderer.send('studio:done', d),
  ready: () => ipcRenderer.send('studio:ready')
}

contextBridge.exposeInMainWorld('studioApi', api)
