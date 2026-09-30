import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useActiveRepo, useActiveWorktree, useActiveWorktreeId, useRepoById } from '@/store/selectors'
import type {
  FileSnapshotChange,
  FileSnapshotSummary,
  FileSnapshotTarget
} from '../../../../shared/file-snapshot-types'
import { resolveFileSnapshotTarget } from './file-snapshot-target'

export type FileSnapshotsState = {
  target: FileSnapshotTarget | null
  summary: FileSnapshotSummary | null
  loading: boolean
  /** Set when the last load or mutation failed; cleared on the next success. */
  error: string | null
  refreshing: boolean
  acceptFile: (change: FileSnapshotChange) => Promise<void>
  acceptFiles: (relativePaths: readonly string[]) => Promise<void>
  revertFile: (change: FileSnapshotChange) => Promise<void>
  revertFiles: (relativePaths: readonly string[]) => Promise<void>
  acceptAll: () => Promise<void>
  revertAll: () => Promise<void>
  capture: () => Promise<void>
  rebuild: () => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Owns the snapshot panel's data: which workspace it is showing, the current
 * summary, and every mutation. Why the panel does not read this from the app
 * store: snapshots are per-workspace state owned by the main process, and
 * caching them in the global store would need invalidation on every external
 * file write the panel never sees.
 */
export function useFileSnapshots(): FileSnapshotsState {
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  // Why a second repo lookup, keyed on the active repo rather than the
  // worktree's: this is the fallback for when no worktree row resolves, and in
  // exactly that case `activeWorktree?.repoId` is null too, so deriving the
  // repo from the worktree would leave the fallback permanently unreachable.
  const fallbackRepo = useActiveRepo()
  const repo = activeRepo ?? fallbackRepo
  const worktreePath = activeWorktree?.path ?? null
  const repoPath = repo?.path ?? null
  // Why the connection id rides along: the same relative path means a different
  // file on an SSH host, so the target must carry the host identity.
  const connectionId = repo?.connectionId ?? undefined

  // Why the repo root is the fallback: the active worktree row can be missing
  // (a host-qualified lookup that missed, or an active repo with nothing
  // selected), and without a directory the panel had nothing to send.
  const activeWorktreeId = useActiveWorktreeId()
  const target = useMemo<FileSnapshotTarget | null>(
    () =>
      resolveFileSnapshotTarget({
        workspaceId: activeWorktreeId ?? activeWorktree?.id ?? repo?.id ?? null,
        worktreePath,
        repoPath,
        connectionId
      }),
    [activeWorktree?.id, activeWorktreeId, connectionId, repo?.id, repoPath, worktreePath]
  )

  const [summary, setSummary] = useState<FileSnapshotSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Why a request token: switching workspaces mid-flight must not let the old
  // workspace's summary land in the new workspace's panel.
  const requestTokenRef = useRef(0)

  const runSummary = useCallback(
    async (operation: () => Promise<FileSnapshotSummary>, asRefresh: boolean): Promise<void> => {
      const token = ++requestTokenRef.current
      if (asRefresh) {
        setRefreshing(true)
      } else {
        setLoading(true)
      }
      try {
        const next = await operation()
        if (token !== requestTokenRef.current) {
          return
        }
        setSummary(next)
        setError(null)
      } catch (err: unknown) {
        if (token !== requestTokenRef.current) {
          return
        }
        // Why keep the previous summary on failure: an agent holding the SSH
        // connection or a file lock should not blank out the list the user is
        // reading; the error banner explains the stale view.
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (token === requestTokenRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    []
  )

  const requireTarget = useCallback((): FileSnapshotTarget => {
    if (!target) {
      throw new Error('No workspace is selected')
    }
    return target
  }, [target])

  const targetKey = target
    ? `${target.workspaceId ?? ''}\u0000${target.connectionId ?? ''}\u0000${target.workspacePath}`
    : null

  useEffect(() => {
    requestTokenRef.current += 1
    setSummary(null)
    setError(null)
    setRefreshing(false)
    setLoading(Boolean(target))
    if (!target) {
      return
    }
    void runSummary(() => window.api.fileSnapshots.status(target), false)
  }, [targetKey])

  const refresh = useCallback(
    () => runSummary(() => window.api.fileSnapshots.status(requireTarget()), true),
    [requireTarget, runSummary]
  )

  const acceptFile = useCallback(
    (change: FileSnapshotChange) =>
      runSummary(
        () =>
          window.api.fileSnapshots.acceptFile({
            target: requireTarget(),
            relativePath: change.relativePath
          }),
        true
      ),
    [requireTarget, runSummary]
  )

  const acceptFiles = useCallback(
    (relativePaths: readonly string[]) =>
      runSummary(
        () =>
          window.api.fileSnapshots.acceptFiles({
            target: requireTarget(),
            relativePaths: [...relativePaths]
          }),
        true
      ),
    [requireTarget, runSummary]
  )

  const revertFile = useCallback(
    (change: FileSnapshotChange) =>
      runSummary(
        () =>
          window.api.fileSnapshots.revertFile({
            target: requireTarget(),
            relativePath: change.relativePath
          }),
        true
      ),
    [requireTarget, runSummary]
  )

  const revertFiles = useCallback(
    (relativePaths: readonly string[]) =>
      runSummary(
        () =>
          window.api.fileSnapshots.revertFiles({
            target: requireTarget(),
            relativePaths: [...relativePaths]
          }),
        true
      ),
    [requireTarget, runSummary]
  )

  const acceptAll = useCallback(
    () => runSummary(() => window.api.fileSnapshots.acceptAll(requireTarget()), true),
    [requireTarget, runSummary]
  )

  const revertAll = useCallback(
    () => runSummary(() => window.api.fileSnapshots.revertAll(requireTarget()), true),
    [requireTarget, runSummary]
  )

  const capture = useCallback(
    () => runSummary(() => window.api.fileSnapshots.capture(requireTarget()), true),
    [requireTarget, runSummary]
  )

  const rebuild = useCallback(
    () => runSummary(() => window.api.fileSnapshots.rebuild(requireTarget()), true),
    [requireTarget, runSummary]
  )

  return {
    target,
    summary,
    loading,
    error,
    refreshing,
    acceptFile,
    acceptFiles,
    revertFile,
    revertFiles,
    acceptAll,
    revertAll,
    capture,
    rebuild,
    refresh
  }
}