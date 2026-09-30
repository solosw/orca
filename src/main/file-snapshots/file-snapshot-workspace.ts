import { rename, rm, writeFile, mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Store } from '../persistence'
import { requireSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { resolveAuthorizedPath } from '../ipc/filesystem-auth'
import { listQuickOpenFiles } from '../ipc/filesystem-list-files'
import { FileRangeReadUnsupportedError } from '../providers/filesystem-provider-contract'
import {
  NodeFileReadTooLargeError,
  readNodeFileWithinLimit
} from '../../shared/node-bounded-file-reader'
import { FileReadCapExceededError } from '../ssh/ssh-filesystem-stream-reader'
import { FILE_SNAPSHOT_MAX_TEXT_BYTES } from '../../shared/file-snapshot-types'
import type { FileSnapshotTarget } from '../../shared/file-snapshot-types'

/**
 * Result of reading a file for snapshotting. Why a union rather than
 * `Buffer | null`: the engine must tell "the file is gone" (a real deletion)
 * apart from "the file is binary or too large to compare" (not a change we can
 * show or revert), and collapsing both into null made every binary file look
 * permanently deleted.
 */
export type FileSnapshotReadResult =
  | { kind: 'text'; content: Buffer }
  | { kind: 'binary' }
  /** Past the text-size cap; tracked by name only. */
  | { kind: 'oversized' }
  | { kind: 'absent' }

/**
 * The file operations the snapshot engine needs, expressed once so the engine
 * never branches on local-vs-SSH and never imports the SSH provider registry.
 */
export type FileSnapshotWorkspace = {
  /** Workspace-relative, `/`-separated paths, honoring .gitignore. */
  listTrackedFiles(): Promise<string[]>
  readTextFile(relativePath: string): Promise<FileSnapshotReadResult>
  writeTextFile(relativePath: string, content: Buffer): Promise<void>
  /** Removes a file, treating "already gone" as success. */
  deleteFile(relativePath: string): Promise<void>
}

function isAbsentPathError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false
  }
  const { code } = error
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function isSnapshotSizeError(error: unknown): boolean {
  if (error instanceof NodeFileReadTooLargeError || error instanceof FileReadCapExceededError) {
    return true
  }
  // Older SSH relays expose the size limit as a plain Error message.
  return error instanceof Error && /^File too large:/i.test(error.message)
}

/** A NUL byte in the head is the same probe the editor uses to call a file binary. */
function hasBinaryPrefix(content: Buffer): boolean {
  const probeLength = Math.min(content.length, 8192)
  for (let index = 0; index < probeLength; index += 1) {
    if (content[index] === 0) {
      return true
    }
  }
  return false
}

export function classifySnapshotContent(content: Buffer): FileSnapshotReadResult {
  if (content.length > FILE_SNAPSHOT_MAX_TEXT_BYTES) {
    return { kind: 'oversized' }
  }
  return hasBinaryPrefix(content) ? { kind: 'binary' } : { kind: 'text', content }
}

export function createLocalFileSnapshotWorkspace(
  workspacePath: string,
  store: Store
): FileSnapshotWorkspace {
  const absolutePathFor = async (relativePath: string): Promise<string> => {
    const authorizedRoot = await resolveAuthorizedPath(workspacePath, store)
    return resolveAuthorizedPath(`${authorizedRoot}/${relativePath}`, store)
  }

  return {
    listTrackedFiles: () =>
      // Why the primary pass only: Quick Open unions in the gitignored pass,
      // but a snapshot must respect the user's own .gitignore — restoring build
      // output on revert is worse than not tracking it.
      listQuickOpenFiles(workspacePath, store, undefined, undefined, undefined, undefined, undefined, {
        includeIgnoredFiles: false
      }),
    readTextFile: async (relativePath) => {
      const absolutePath = await absolutePathFor(relativePath)
      try {
        const stats = await stat(absolutePath)
        if (stats.size > FILE_SNAPSHOT_MAX_TEXT_BYTES) {
          return { kind: 'oversized' }
        }
        const { buffer } = await readNodeFileWithinLimit(
          absolutePath,
          FILE_SNAPSHOT_MAX_TEXT_BYTES
        )
        return classifySnapshotContent(buffer)
      } catch (error) {
        if (error instanceof NodeFileReadTooLargeError) {
          return { kind: 'oversized' }
        }
        if (isAbsentPathError(error)) {
          return { kind: 'absent' }
        }
        throw error
      }
    },
    writeTextFile: async (relativePath, content) => {
      const absolutePath = await absolutePathFor(relativePath)
      await mkdir(dirname(absolutePath), { recursive: true })
      // Why temp-then-rename: a revert must not be observed half-written by the
      // file watcher that triggers the next listing.
      const tempPath = `${absolutePath}.orca-snapshot.${process.pid}.${Date.now()}.tmp`
      let renamed = false
      try {
        await writeFile(tempPath, content)
        await rename(tempPath, absolutePath)
        renamed = true
      } finally {
        if (!renamed) {
          await rm(tempPath, { force: true }).catch(() => {})
        }
      }
    },
    deleteFile: async (relativePath) => {
      const absolutePath = await absolutePathFor(relativePath)
      await rm(absolutePath, { force: true }).catch((error: unknown) => {
        if (!isAbsentPathError(error)) {
          throw error
        }
      })
    }
  }
}

export function createSshFileSnapshotWorkspace(
  workspacePath: string,
  connectionId: string
): FileSnapshotWorkspace {
  const root = workspacePath.replace(/\/+$/, '')
  const absolutePathFor = (relativePath: string): string =>
    relativePath.startsWith('/') ? relativePath : `${root}/${relativePath}`

  return {
    listTrackedFiles: async () => {
      const provider = requireSshFilesystemProvider(connectionId)
      return provider.listFiles(root)
    },
    readTextFile: async (relativePath) => {
      const provider = requireSshFilesystemProvider(connectionId)
      const absolutePath = absolutePathFor(relativePath)
      try {
        // Why stat first: readFile's limit is a transport safety cap, but it
        // still throws after starting the transfer. Snapshots should skip an
        // oversized file before allocating or transferring its contents.
        const stats = await provider.stat(absolutePath)
        if (stats.size > FILE_SNAPSHOT_MAX_TEXT_BYTES) {
          return { kind: 'oversized' }
        }
        const result = await provider.readFile(absolutePath, {
          maxTextBytes: FILE_SNAPSHOT_MAX_TEXT_BYTES
        })
        if (result.isBinary) {
          return { kind: 'binary' }
        }
        return classifySnapshotContent(Buffer.from(result.content, 'utf8'))
      } catch (error) {
        if (isSnapshotSizeError(error)) {
          return { kind: 'oversized' }
        }
        if (error instanceof FileRangeReadUnsupportedError) {
          return { kind: 'binary' }
        }
        if (isAbsentPathError(error)) {
          return { kind: 'absent' }
        }
        throw error
      }
    },
    writeTextFile: async (relativePath, content) => {
      const provider = requireSshFilesystemProvider(connectionId)
      const absolutePath = absolutePathFor(relativePath)
      await provider.createDir(dirname(absolutePath)).catch(() => {})
      await provider.writeFile(absolutePath, content.toString('utf8'))
    },
    deleteFile: async (relativePath) => {
      const provider = requireSshFilesystemProvider(connectionId)
      await provider.deletePath(absolutePathFor(relativePath)).catch((error: unknown) => {
        if (!isAbsentPathError(error)) {
          throw error
        }
      })
    }
  }
}

export function createFileSnapshotWorkspace(
  target: FileSnapshotTarget,
  store: Store
): FileSnapshotWorkspace {
  return target.connectionId
    ? createSshFileSnapshotWorkspace(target.workspacePath, target.connectionId)
    : createLocalFileSnapshotWorkspace(target.workspacePath, store)
}