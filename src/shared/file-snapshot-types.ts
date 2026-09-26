/**
 * File snapshots — a per-workspace, git-independent record of what the files
 * looked like before an agent (or any external editor) touched them.
 *
 * Why this exists apart from source control: folder workspaces are not git
 * repositories at all, and even inside one a worktree's own commit history is
 * not the boundary a user reasons about when an agent rewrites a dozen files —
 * they want "what did it change, show me, keep it or throw it away", without a
 * commit, a stash, or an index involved.
 */

/** How a tracked path differs from its snapshot. Mirrors source-control vocabulary deliberately. */
export type FileSnapshotStatus = 'added' | 'modified' | 'deleted'

export type FileSnapshotChange = {
  /** Workspace-relative path, `/`-separated on every platform. */
  relativePath: string
  status: FileSnapshotStatus
  /** Line counts against the snapshot; 0 for binary or unreadable content. */
  additions: number
  deletions: number
}

export type FileSnapshotSummary = {
  /** False until the workspace has been snapshotted at least once. */
  initialized: boolean
  /** Wall-clock ms of the last snapshot write, or null when never initialized. */
  capturedAt: number | null
  /** Total tracked text files in the snapshot manifest. */
  trackedFileCount: number
  changes: FileSnapshotChange[]
}

export type FileSnapshotContent = {
  /** Snapshot side of the comparison; '' when the file is newly added. */
  original: string
  /** Current on-disk side; '' when the file was deleted. */
  modified: string
  /** True when either side is binary, so the UI shows a notice instead of an empty diff. */
  binary: boolean
}

export type FileSnapshotTarget = {
  /** Workspace root as the renderer knows it (absolute local path, or remote path for SSH). */
  workspacePath: string
  /** SSH connection id; absent means a local workspace. */
  connectionId?: string
}

/** Above this size a file is tracked by name only, never snapshotted or diffed. */
export const FILE_SNAPSHOT_MAX_TEXT_BYTES = 5 * 1024 * 1024

/** Content stored per file object is gzipped; the cap bounds worst-case disk per workspace. */
export const FILE_SNAPSHOT_MAX_TRACKED_FILES = 20_000