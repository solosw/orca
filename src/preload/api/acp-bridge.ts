import { ipcRenderer } from 'electron'
import { ACP_CHANNELS } from '../../shared/acp-channels'
import type { PreloadApi } from '../api-types'

export const acpApi = {
  startSession: (args) => ipcRenderer.invoke(ACP_CHANNELS.startSession, args),
  prompt: (args) => ipcRenderer.invoke(ACP_CHANNELS.prompt, args),
  setMode: (args) => ipcRenderer.invoke(ACP_CHANNELS.setMode, args),
  cancel: (args) => ipcRenderer.invoke(ACP_CHANNELS.cancel, args),
  close: (args) => ipcRenderer.invoke(ACP_CHANNELS.close, args),
  list: () => ipcRenderer.invoke(ACP_CHANNELS.list),
  view: (args) => ipcRenderer.invoke(ACP_CHANNELS.view, args),
  clear: (args) => ipcRenderer.invoke(ACP_CHANNELS.clear, args),
  respondPermission: (args) => ipcRenderer.invoke(ACP_CHANNELS.respondPermission, args),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload)
    ipcRenderer.on(ACP_CHANNELS.event, listener)
    return () => ipcRenderer.removeListener(ACP_CHANNELS.event, listener)
  },
  onPermissionRequest: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, request: Parameters<typeof callback>[0]) =>
      callback(request)
    ipcRenderer.on(ACP_CHANNELS.permissionRequest, listener)
    return () => ipcRenderer.removeListener(ACP_CHANNELS.permissionRequest, listener)
  }
} satisfies PreloadApi['acp']