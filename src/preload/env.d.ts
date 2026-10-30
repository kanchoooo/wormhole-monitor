import type { OverlayApi, ToolboxApi } from '@shared/types'

declare global {
  interface Window {
    overlayApi: OverlayApi
    toolboxApi: ToolboxApi
  }
}

export {}
