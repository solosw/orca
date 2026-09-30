import { describe, expect, it } from 'vitest'
import { resolveFileSnapshotTarget } from './file-snapshot-target'

describe('resolveFileSnapshotTarget', () => {
  it('targets the active worktree when one is selected', () => {
    expect(
      resolveFileSnapshotTarget({
        worktreePath: '/repo/wt-feature',
        repoPath: '/repo',
        connectionId: null
      })
    ).toEqual({ workspacePath: '/repo/wt-feature' })
  })

  it('falls back to the repo root when no worktree row resolves', () => {
    // Why this is the regression under test: before the fallback, this input
    // produced null, so the panel had no directory to send and every snapshot
    // call was refused.
    expect(
      resolveFileSnapshotTarget({
        worktreePath: null,
        repoPath: '/repo',
        connectionId: null
      })
    ).toEqual({ workspacePath: '/repo' })
  })

  it('prefers the worktree when the repo lookup missed on another host', () => {
    expect(
      resolveFileSnapshotTarget({
        worktreePath: '/repo/wt-feature',
        repoPath: null,
        connectionId: null
      })
    ).toEqual({ workspacePath: '/repo/wt-feature' })
  })

  it('treats an empty path as absent rather than as the working directory', () => {
    // An empty workspacePath is what the main process rejects, so a blank
    // worktree path must fall through to the repo instead of being sent as ''.
    expect(
      resolveFileSnapshotTarget({ worktreePath: '', repoPath: '/repo', connectionId: null })
    ).toEqual({ workspacePath: '/repo' })
    expect(
      resolveFileSnapshotTarget({ worktreePath: '', repoPath: '', connectionId: null })
    ).toBeNull()
  })

  it('returns null only when no directory is known at all', () => {
    expect(
      resolveFileSnapshotTarget({ worktreePath: null, repoPath: null, connectionId: null })
    ).toBeNull()
  })

  it('carries the SSH connection id so a remote path is not read locally', () => {
    expect(
      resolveFileSnapshotTarget({
        worktreePath: '/srv/repo/wt',
        repoPath: '/srv/repo',
        connectionId: 'ssh-1'
      })
    ).toEqual({ workspacePath: '/srv/repo/wt', connectionId: 'ssh-1' })
  })

  it('omits the connection id for a local workspace', () => {
    expect(
      resolveFileSnapshotTarget({
        worktreePath: '/repo',
        repoPath: null,
        connectionId: undefined
      })
    ).toEqual({ workspacePath: '/repo' })
  })
})