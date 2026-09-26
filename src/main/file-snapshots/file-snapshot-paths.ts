import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'

const FILE_SNAPSHOT_ROOT_DIR_NAME = 'file-snapshots'

/**
 * Canonical identity for a workspace's snapshot store. On Windows the same
 * directory can arrive as `C:\repo` or `c:/repo` depending on the caller, so
 * fold separators and case before hashing or one workspace gets two stores.
 */
function normalizeWorkspaceIdentityPath(workspacePath: string): string {
  const slashed = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed
}

/**
 * Why hash the identity instead of reusing the path: the same local folder
 * reached through an SSH connection is a different set of file contents, and a
 * raw path is not filesystem-safe as a single directory name.
 */
function fileSnapshotWorkspaceKey(workspacePath: string, connectionId?: string): string {
  const normalizedPath = normalizeWorkspaceIdentityPath(workspacePath)
  const identity = connectionId
    ? `ssh:${connectionId}:${normalizedPath}`
    : `local:${normalizedPath}`
  return createHash('sha256').update(identity).digest('hex').slice(0, 32)
}

export function fileSnapshotWorkspaceDir(workspacePath: string, connectionId?: string): string {
  return join(
    getAppEnvironment().getPath('userData'),
    FILE_SNAPSHOT_ROOT_DIR_NAME,
    fileSnapshotWorkspaceKey(workspacePath, connectionId)
  )
}

export function fileSnapshotManifestPath(workspaceDir: string): string {
  return join(workspaceDir, 'manifest.json')
}

/** Two-level fan-out keeps object directories small; mirrors the shape of `.git/objects`. */
export function fileSnapshotObjectPath(workspaceDir: string, hash: string): string {
  return join(workspaceDir, 'objects', hash.slice(0, 2), hash.slice(2))
}