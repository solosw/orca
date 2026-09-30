import { ipcMain } from 'electron'
import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  FileSnapshotContent,
  FileSnapshotSummary,
  FileSnapshotTarget
} from '../../shared/file-snapshot-types'
import { FILE_SNAPSHOT_CHANNELS } from '../../shared/file-snapshot-channels'
import type { Store } from '../persistence'
import { createFileSnapshotEngine } from '../file-snapshots/file-snapshot-engine'
import {
  fileSnapshotWorkspaceDir,
  legacyFileSnapshotWorkspaceDir,
  fileSnapshotManifestPath
} from '../file-snapshots/file-snapshot-paths'

/** Reads one property off an untrusted IPC payload without asserting its type. */
function readField(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function parseTarget(value: unknown): FileSnapshotTarget {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid file snapshot target')
  }
  const workspacePath = readField(value, 'workspacePath')
  const workspaceId = readField(value, 'workspaceId')
  const connectionId = readField(value, 'connectionId')
  if (workspaceId !== undefined && (typeof workspaceId !== 'string' || workspaceId.length === 0)) {
    throw new Error('Invalid file snapshot target: workspaceId must be a non-empty string')
  }
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
    ? { workspacePath, connectionId, ...(workspaceId ? { workspaceId } : {}) }
    : { workspacePath, ...(workspaceId ? { workspaceId } : {}) }
}

function assertRelativePath(relativePath: string): string {
  if (relativePath.length === 0) {
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

function parseRelativePath(value: unknown): string {
  const relativePath = readField(value, 'relativePath')
  if (typeof relativePath !== 'string') {
    throw new Error('Invalid file snapshot request: relativePath is required')
  }
  return assertRelativePath(relativePath)
}

function parseRelativePaths(value: unknown): string[] {
  const relativePaths = readField(value, 'relativePaths')
  if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
    throw new Error('Invalid file snapshot request: relativePaths is required')
  }
  return relativePaths.map((relativePath, index) => {
    if (typeof relativePath !== 'string') {
      throw new Error(
        `Invalid file snapshot request: relativePaths[${index}] must be a string`
      )
    }
    return assertRelativePath(relativePath)
  })
}

async function migrateLegacySnapshotStore(target: FileSnapshotTarget, workspaceDir: string): Promise<void> {
  if (!target.workspaceId) {
    return
  }
  try {
    await stat(fileSnapshotManifestPath(workspaceDir))
    return
  } catch {
    // The identity-scoped store does not exist yet.
  }
  const legacyDir = legacyFileSnapshotWorkspaceDir(target.workspacePath, target.connectionId)
  try {
    await stat(fileSnapshotManifestPath(legacyDir))
  } catch {
    return
  }
  await mkdir(dirname(workspaceDir), { recursive: true })
  await cp(legacyDir, workspaceDir, { recursive: true, force: false, errorOnExist: false })
}

export function registerFileSnapshotHandlers(store: Store): void {
  const engineFor = async (target: FileSnapshotTarget): Promise<ReturnType<typeof createFileSnapshotEngine>> => {
    const workspaceDir = fileSnapshotWorkspaceDir(
      target.workspacePath,
      target.connectionId,
      target.workspaceId
    )
    await migrateLegacySnapshotStore(target, workspaceDir)
    return createFileSnapshotEngine(target, store, workspaceDir)
  }

  for (const channel of Object.values(FILE_SNAPSHOT_CHANNELS)) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.status,
    async (_event, rawTarget?: unknown): Promise<FileSnapshotSummary> =>
      (await engineFor(parseTarget(rawTarget))).summary()
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.capture,
    async (_event, rawTarget?: unknown): Promise<FileSnapshotSummary> =>
      (await engineFor(parseTarget(rawTarget))).capture()
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.rebuild,
    async (_event, rawTarget?: unknown): Promise<FileSnapshotSummary> =>
      (await engineFor(parseTarget(rawTarget))).rebuild()
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.acceptFile,
    async (_event, rawArgs?: unknown): Promise<FileSnapshotSummary> => {
      const relativePath = parseRelativePath(rawArgs)
      return (await engineFor(parseTarget(readField(rawArgs, 'target')))).acceptFile(relativePath)
    }
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.acceptFiles,
    async (_event, rawArgs?: unknown): Promise<FileSnapshotSummary> => {
      const relativePaths = parseRelativePaths(rawArgs)
      return (await engineFor(parseTarget(readField(rawArgs, 'target')))).acceptFiles(relativePaths)
    }
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.acceptAll,
    async (_event, rawTarget?: unknown): Promise<FileSnapshotSummary> =>
      (await engineFor(parseTarget(rawTarget))).acceptAll()
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.revertFile,
    async (_event, rawArgs?: unknown): Promise<FileSnapshotSummary> => {
      const relativePath = parseRelativePath(rawArgs)
      return (await engineFor(parseTarget(readField(rawArgs, 'target')))).revertFile(relativePath)
    }
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.revertFiles,
    async (_event, rawArgs?: unknown): Promise<FileSnapshotSummary> => {
      const relativePaths = parseRelativePaths(rawArgs)
      return (await engineFor(parseTarget(readField(rawArgs, 'target')))).revertFiles(relativePaths)
    }
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.revertAll,
    async (_event, rawTarget?: unknown): Promise<FileSnapshotSummary> =>
      (await engineFor(parseTarget(rawTarget))).revertAll()
  )

  ipcMain.handle(
    FILE_SNAPSHOT_CHANNELS.content,
    async (_event, rawArgs?: unknown): Promise<FileSnapshotContent> => {
      const relativePath = parseRelativePath(rawArgs)
      return (await engineFor(parseTarget(readField(rawArgs, 'target')))).content(relativePath)
    }
  )
}