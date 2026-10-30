import type { OverlayApi, StudioApi, ToolboxApi } from '@shared/types'

declare global {
  interface Window {
    overlayApi: OverlayApi
    toolboxApi: ToolboxApi
    studioApi: StudioApi
  }
}

export {}
