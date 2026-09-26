import { ipcMain } from 'electron'
import type {
  FileSnapshotContent,
  FileSnapshotSummary,
  FileSnapshotTarget
} from '../../shared/file-snapshot-types'
import { FILE_SNAPSHOT_CHANNELS } from '../../shared/file-snapshot-channels'
import type { Store } from '../persistence'
import { createFileSnapshotEngine } from '../file-snapshots/file-snapshot-engine'
import { fileSnapshotWorkspaceDir } from '../file-snapshots/file-snapshot-paths'

/** Reads one property off an untrusted IPC payload without asserting its type. */
function readField(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function parseTarget(value: unknown): FileSnapshotTarget {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid file snapshot target')
  }
  const workspacePath = readField(value, 'workspacePath')
  const connectionId = readField(value, 'connectionId')
  if (typeof workspacePath !== 'string' || workspacePath.length === 0) {
    throw new Error('Invalid file snapshot target: workspacePath is required')
  }
  // Why reject a non-string connectionId instead of coercing it: coercing it to
  // undefined routes a remote workspace's snapshots to the LOCAL filesystem,
  // where the same relative path means a different file.
  if (connectionId !== undefined && typeof connectionId !== 'string') {
    throw new Error('Invalid file snapshot target: connectionId must be a string')
  }
  return connectionId
    ? { workspacePath, connectionId }
    : { workspacePath }
}

function parseRelativePath(value: unknown): string {
  const relativePath = readField(value, 'relativePath')
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('Invalid file snapshot request: relativePath is required')
  }
  // Why reject traversal and absolute paths here: the engine joins these onto
  // the workspace root, so an unchecked value could read or overwrite a file
  // entirely outside the workspace the user opened.
  if (relativePath.startsWith('/') || /^[A-Za-z]:/.test(relativePath)) {
    throw new Error('Invalid file snapshot request: relativePath must be workspace-relative')
  }
  if (relativePath.split(/[\\/]/).includes('..')) {
    throw new Error('Invalid file snapshot request: relativePath must not escape the workspace')
  }
  return relativePath
}

export function registerFileSnapshotHandlers(store: Store): void {
  const engineFor = (target: FileSnapshotTarget) =>
    createFileSnapshotEngine(
      target,
      store,
      fileSnapshotWorkspaceDir(target.workspacePath, target.connectionId)
    )

  for (const channel of Object.values(FILE_SNAPSHOT_CHANNELS)) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.status,
    async (_event, rawTarget?: unknown): Promise<FileSnapshotSummary> =>
      engineFor(parseTarget(rawTarget)).summary()
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.capture,
    async (_event, rawTarget?: unknown): Promise<FileSnapshotSummary> =>
      engineFor(parseTarget(rawTarget)).capture()
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.acceptFile,
    async (_event, rawArgs?: unknown): Promise<FileSnapshotSummary> => {
      const relativePath = parseRelativePath(rawArgs)
      return engineFor(parseTarget(readField(rawArgs, 'target'))).acceptFile(relativePath)
    }
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.acceptAll,
    async (_event, rawTarget?: unknown): Promise<FileSnapshotSummary> =>
      engineFor(parseTarget(rawTarget)).acceptAll()
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.revertFile,
    async (_event, rawArgs?: unknown): Promise<FileSnapshotSummary> => {
      const relativePath = parseRelativePath(rawArgs)
      return engineFor(parseTarget(readField(rawArgs, 'target'))).revertFile(relativePath)
    }
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.revertAll,
    async (_event, rawTarget?: unknown): Promise<FileSnapshotSummary> =>
      engineFor(parseTarget(rawTarget)).revertAll()
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.content,
    async (_event, rawArgs?: unknown): Promise<FileSnapshotContent> => {
      const relativePath = parseRelativePath(rawArgs)
      return engineFor(parseTarget(readField(rawArgs, 'target'))).content(relativePath)
    }
  )
}