import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  countFileSnapshotLineChanges,
  FileSnapshotEngine
} from './file-snapshot-engine'
import type {
  FileSnapshotReadResult,
  FileSnapshotWorkspace
} from './file-snapshot-workspace'

/**
 * In-memory workspace stand-in. Why not touch the real filesystem: the engine's
 * contract is entirely about what it asks the workspace for and what it writes
 * to the store, and a fake makes the "file vanished between list and read" case
 * expressible without racing a real watcher.
 */
class FakeWorkspace implements FileSnapshotWorkspace {
  files = new Map<string, string>()
  /** Paths listed but absent on read, to simulate a delete mid-scan. */
  unreadable = new Set<string>()
  writes: string[] = []
  deletes: string[] = []
  listCalls = 0

  listTrackedFiles(): Promise<string[]> {
    this.listCalls += 1
    return Promise.resolve([...this.files.keys()].sort())
  }

  readTextFile(relativePath: string): Promise<FileSnapshotReadResult> {
    if (this.unreadable.has(relativePath)) {
      return Promise.resolve({ kind: 'absent' })
    }
    const content = this.files.get(relativePath)
    if (content === undefined) {
      return Promise.resolve({ kind: 'absent' })
    }
    return Promise.resolve({ kind: 'text', content: Buffer.from(content, 'utf8') })
  }

  writeTextFile(relativePath: string, content: Buffer): Promise<void> {
    this.writes.push(relativePath)
    this.files.set(relativePath, content.toString('utf8'))
    return Promise.resolve()
  }

  deleteFile(relativePath: string): Promise<void> {
    this.deletes.push(relativePath)
    this.files.delete(relativePath)
    return Promise.resolve()
  }
}

describe('countFileSnapshotLineChanges', () => {
  it('counts added and removed lines by multiset', () => {
    const original = Buffer.from('a\nb\nc\n', 'utf8')
    const modified = Buffer.from('a\nB\nc\nd\n', 'utf8')
    expect(countFileSnapshotLineChanges(original, modified)).toEqual({
      additions: 2,
      deletions: 1
    })
  })

  it('counts a whole new file as additions', () => {
    expect(countFileSnapshotLineChanges(null, Buffer.from('one\ntwo\n', 'utf8'))).toEqual({
      additions: 2,
      deletions: 0
    })
  })

  it('treats a trailing newline as a terminator, not an extra empty line', () => {
    const withNewline = Buffer.from('a\nb\n', 'utf8')
    const withoutNewline = Buffer.from('a\nb', 'utf8')
    expect(countFileSnapshotLineChanges(withNewline, withoutNewline)).toEqual({
      additions: 0,
      deletions: 0
    })
  })
})

describe('FileSnapshotEngine', () => {
  let workspaceDir: string
  let workspace: FakeWorkspace

  const engine = (): FileSnapshotEngine =>
    new FileSnapshotEngine({ workspace, workspaceDir })

  beforeEach(async () => {
    workspaceDir = await mkdtemp(join(tmpdir(), 'orca-snapshot-test-'))
    workspace = new FakeWorkspace()
  })

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true })
  })

  it('reports uninitialized before any capture and lists nothing as changed', async () => {
    workspace.files.set('src/a.ts', 'export const a = 1\n')
    const summary = await engine().summary()
    expect(summary.initialized).toBe(false)
    expect(summary.capturedAt).toBeNull()
    // Why: a first-run panel showing every file as "added" would describe our
    // own missing baseline, not anything the user changed.
    expect(summary.changes).toEqual([])
  })

  it('captures a baseline then reports nothing changed', async () => {
    workspace.files.set('src/a.ts', 'export const a = 1\n')
    const captured = await engine().capture()
    expect(captured.initialized).toBe(true)
    expect(captured.trackedFileCount).toBe(1)
    expect((await engine().summary()).changes).toEqual([])
  })

  it('classifies added, modified and deleted files', async () => {
    workspace.files.set('keep.ts', 'stable\n')
    workspace.files.set('edit.ts', 'before\n')
    workspace.files.set('gone.ts', 'deleted content\n')
    await engine().capture()

    workspace.files.set('edit.ts', 'after\n')
    workspace.files.set('new.ts', 'brand new\n')
    workspace.files.delete('gone.ts')

    const summary = await engine().summary()
    const byPath = Object.fromEntries(summary.changes.map((c) => [c.relativePath, c]))
    expect(byPath['new.ts']?.status).toBe('added')
    expect(byPath['new.ts']?.additions).toBe(1)
    expect(byPath['edit.ts']?.status).toBe('modified')
    expect(byPath['edit.ts']?.additions).toBe(1)
    expect(byPath['edit.ts']?.deletions).toBe(1)
    expect(byPath['gone.ts']?.status).toBe('deleted')
    expect(byPath['keep.ts']).toBeUndefined()
  })

  it('reverts a modified file to its snapshot content', async () => {
    workspace.files.set('edit.ts', 'before\n')
    await engine().capture()
    workspace.files.set('edit.ts', 'after\n')

    await engine().revertFile('edit.ts')
    expect(workspace.files.get('edit.ts')).toBe('before\n')
    expect((await engine().summary()).changes).toEqual([])
  })

  it('deletes a file that was created after the baseline instead of emptying it', async () => {
    workspace.files.set('tracked.ts', 'x\n')
    await engine().capture()
    workspace.files.set('created.ts', 'agent wrote this\n')

    await engine().revertFile('created.ts')
    expect(workspace.deletes).toContain('created.ts')
    expect(workspace.files.has('created.ts')).toBe(false)
  })

  it('accepts a single file without touching a sibling modification', async () => {
    workspace.files.set('a.ts', 'a1\n')
    workspace.files.set('b.ts', 'b1\n')
    await engine().capture()
    workspace.files.set('a.ts', 'a2\n')
    workspace.files.set('b.ts', 'b2\n')

    await engine().acceptFile('a.ts')
    const summary = await engine().summary()
    expect(summary.changes.map((c) => c.relativePath)).toEqual(['b.ts'])
  })

  it('accept-all rebaselines every change', async () => {
    workspace.files.set('a.ts', 'a1\n')
    await engine().capture()
    workspace.files.set('a.ts', 'a2\n')
    workspace.files.set('b.ts', 'new\n')

    const accepted = await engine().acceptAll()
    expect(accepted.changes).toEqual([])
    expect(accepted.trackedFileCount).toBe(2)
    expect((await engine().summary()).changes).toEqual([])
  })

  it('revert-all restores modifications and removes additions', async () => {
    workspace.files.set('a.ts', 'a1\n')
    await engine().capture()
    workspace.files.set('a.ts', 'a2\n')
    workspace.files.set('b.ts', 'new\n')

    await engine().revertAll()
    expect(workspace.files.get('a.ts')).toBe('a1\n')
    expect(workspace.files.has('b.ts')).toBe(false)
    expect((await engine().summary()).changes).toEqual([])
  })

  it('reports a baseline deleted while the manifest survives as deleted, not modified', async () => {
    workspace.files.set('a.ts', 'a1\n')
    await engine().capture()
    // The listing still returns it, but the read finds nothing (a raced delete).
    workspace.unreadable.add('a.ts')

    const summary = await engine().summary()
    expect(summary.changes).toEqual([
      { relativePath: 'a.ts', status: 'deleted', additions: 0, deletions: 0 }
    ])
  })

  it('marks a path tracked only in the manifest as deleted with its snapshot line count', async () => {
    workspace.files.set('a.ts', 'one\ntwo\nthree\n')
    await engine().capture()
    // Dropped from both the listing and the disk (the agent deleted it).
    workspace.files.delete('a.ts')

    const summary = await engine().summary()
    expect(summary.changes).toEqual([
      { relativePath: 'a.ts', status: 'deleted', additions: 0, deletions: 3 }
    ])
  })

  it('returns both sides of the comparison for a modified file', async () => {
    workspace.files.set('a.ts', 'before\n')
    await engine().capture()
    workspace.files.set('a.ts', 'after\n')

    const content = await engine().content('a.ts')
    expect(content.original).toBe('before\n')
    expect(content.modified).toBe('after\n')
    expect(content.binary).toBe(false)
  })

  it('returns an empty original for a file with no snapshot and flags nothing binary', async () => {
    workspace.files.set('new.ts', 'fresh\n')
    await engine().capture()
    workspace.files.set('another.ts', 'later\n')

    const content = await engine().content('another.ts')
    expect(content.original).toBe('')
    expect(content.modified).toBe('later\n')
    expect(content.binary).toBe(false)
  })

  it('flags a non-text current side as binary while still showing the snapshot', async () => {
    workspace.files.set('a.ts', 'text before\n')
    await engine().capture()
    workspace.unreadable.add('a.ts')

    const content = await engine().content('a.ts')
    expect(content.original).toBe('text before\n')
    expect(content.modified).toBe('')
    expect(content.binary).toBe(true)
  })

  it('refuses to accept or revert before a baseline exists', async () => {
    workspace.files.set('a.ts', 'a\n')
    await expect(engine().acceptFile('a.ts')).rejects.toThrow(/no snapshot baseline/i)
    await expect(engine().revertFile('a.ts')).rejects.toThrow(/no snapshot baseline/i)
  })

  it('reads the manifest from disk rather than memory, so a second engine sees the baseline', async () => {
    workspace.files.set('a.ts', 'a1\n')
    await engine().capture()

    const second = new FileSnapshotEngine({ workspace, workspaceDir })
    expect((await second.summary()).initialized).toBe(true)
  })

  it('recovers from a corrupt manifest by treating the workspace as uninitialized', async () => {
    workspace.files.set('a.ts', 'a1\n')
    await engine().capture()
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(workspaceDir, 'manifest.json'), '{ this is not json', 'utf8')

    const summary = await engine().summary()
    expect(summary.initialized).toBe(false)
    expect(summary.changes).toEqual([])
  })
})