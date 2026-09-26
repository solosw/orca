import { ipcRenderer } from 'electron'
import { FILE_SNAPSHOT_CHANNELS } from '../../shared/file-snapshot-channels'
import type { PreloadApi } from '../api-types'

export const fileSnapshotsApi = {
  status: (target) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.status, target),
  capture: (target) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.capture, target),
  acceptFile: (args) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.acceptFile, args),
  acceptAll: (target) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.acceptAll, target),
  revertFile: (args) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.revertFile, args),
  revertAll: (target) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.revertAll, target),
  content: (args) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.content, args)
} satisfies PreloadApi['fileSnapshots']