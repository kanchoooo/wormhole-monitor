import { contextBridge, ipcRenderer } from 'electron'
import type { OverlayApi } from '@shared/types'

function on<T>(channel: string, cb: (v: T) => void): void {
  ipcRenderer.on(channel, (_e, v: T) => cb(v))
}

const api: OverlayApi = {
  platform: process.platform,
  onInit: (cb) => on('overlay:init', cb),
  onFrame: (cb) => on('overlay:frame', cb),
  onScene: (cb) => on('overlay:scene', cb),
  onSettings: (cb) => on('overlay:settings', cb),
  onRecording: (cb) => on('overlay:recording', cb),
  wheel: (dy) => ipcRenderer.send('overlay:wheel', dy),
  ready: () => ipcRenderer.send('overlay:ready')
}

contextBridge.exposeInMainWorld('overlayApi', api)
