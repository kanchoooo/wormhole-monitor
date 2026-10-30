import { contextBridge, ipcRenderer } from 'electron'
import type { ToolboxApi, ToolboxState } from '@shared/types'

const api: ToolboxApi = {
  platform: process.platform,
  onState: (cb) => ipcRenderer.on('toolbox:state', (_e, s: ToolboxState) => cb(s)),
  act: (a) => ipcRenderer.send('toolbox:act', a),
  ready: () => ipcRenderer.send('toolbox:ready')
}

contextBridge.exposeInMainWorld('toolboxApi', api)
