import type { FileSnapshotTarget } from '../../../../shared/file-snapshot-types'

/**
 * Resolves which directory a snapshot request targets, from the active workspace.
 *
 * Why a fallback chain rather than the active worktree alone: the snapshot tab is
 * offered in every workspace kind, while a host-qualified worktree lookup can miss
 * on an SSH or runtime host, and a repo can be active with no worktree row
 * selected. Returning null in those cases left the panel with no directory to
 * send, so every snapshot call was refused and the feature looked broken while a
 * perfectly good current working directory was available.
 *
 * Inputs are accepted independently of the store so the precedence is testable
 * without rendering the hook.
 */
export function resolveFileSnapshotTarget(input: {
  workspaceId?: string | null
  worktreePath: string | null | undefined
  repoPath: string | null | undefined
  connectionId: string | null | undefined
}): FileSnapshotTarget | null {
  // Why `||` and not `??`: an empty path is a missing directory here, and an
  // empty workspacePath is exactly what the main process rejects.
  const workspacePath = input.worktreePath || input.repoPath || ''
  if (!workspacePath) {
    return null
  }
  // Why the connection id rides along: the same relative path means a different
  // file on an SSH host, so the target must carry the host identity.
  return input.connectionId
    ? {
        workspacePath,
        connectionId: input.connectionId,
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {})
      }
    : { workspacePath, ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}) }
}