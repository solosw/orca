import { ipcRenderer } from 'electron'
import { FILE_SNAPSHOT_CHANNELS } from '../../shared/file-snapshot-channels'
import type { PreloadApi } from '../api-types'

export const fileSnapshotsApi = {
  status: (target) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.status, target),
  capture: (target) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.capture, target),
  rebuild: (target) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.rebuild, target),
  acceptFile: (args) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.acceptFile, args),
  acceptFiles: (args) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.acceptFiles, args),
  acceptAll: (target) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.acceptAll, target),
  revertFile: (args) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.revertFile, args),
  revertFiles: (args) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.revertFiles, args),
  revertAll: (target) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.revertAll, target),
  content: (args) => ipcRenderer.invoke(FILE_SNAPSHOT_CHANNELS.content, args)
} satisfies PreloadApi['fileSnapshots']