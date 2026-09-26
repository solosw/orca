import type {
  FileSnapshotChange,
  FileSnapshotContent,
  FileSnapshotSummary,
  FileSnapshotTarget
} from '../../shared/file-snapshot-types'
import {
  hashFileSnapshotContent,
  readFileSnapshotObject,
  writeFileSnapshotObject
} from './file-snapshot-object-store'
import {
  readFileSnapshotManifest,
  writeFileSnapshotManifest,
  type FileSnapshotManifest
} from './file-snapshot-manifest-store'
import {
  createFileSnapshotWorkspace,
  type FileSnapshotReadResult,
  type FileSnapshotWorkspace
} from './file-snapshot-workspace'
import type { Store } from '../persistence'

/**
 * Line-level change counts between a snapshot and the current file.
 *
 * Why not a real LCS diff: this runs on every listed file whenever the panel
 * refreshes, and an agent may have rewritten a multi-megabyte bundle. Counting
 * by line multiset is O(n) with no second full copy of the text, and it is
 * exact for the totals the UI shows (+N/-N), which is all that is displayed.
 */
export function countFileSnapshotLineChanges(
  original: Buffer | null,
  modified: Buffer | null
): { additions: number; deletions: number } {
  const originalCounts = countLines(original)
  const modifiedCounts = countLines(modified)
  let additions = 0
  let deletions = 0
  for (const [line, count] of modifiedCounts) {
    const before = originalCounts.get(line) ?? 0
    if (count > before) {
      additions += count - before
    }
  }
  for (const [line, count] of originalCounts) {
    const after = modifiedCounts.get(line) ?? 0
    if (count > after) {
      deletions += count - after
    }
  }
  return { additions, deletions }
}

function countLines(content: Buffer | null): Map<string, number> {
  const counts = new Map<string, number>()
  if (!content || content.length === 0) {
    return counts
  }
  // A trailing newline terminates the last line rather than starting an empty
  // one, so an added blank line would otherwise be invisible in the count.
  const text = content.toString('utf8').replace(/\n$/, '')
  if (text.length === 0) {
    return counts
  }
  for (const line of text.split('\n')) {
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  return counts
}

export type FileSnapshotEngineDependencies = {
  workspace: FileSnapshotWorkspace
  workspaceDir: string
}

/**
 * Snapshot engine for one workspace. Every method re-reads the manifest instead
 * of caching it: the store is per-workspace state on disk and two windows can
 * act on the same workspace, so an in-memory copy would let one window's accept
 * silently discard another's.
 */
export class FileSnapshotEngine {
  constructor(private readonly dependencies: FileSnapshotEngineDependencies) {}

  async summary(): Promise<FileSnapshotSummary> {
    const [manifest, trackedFiles] = await Promise.all([
      readFileSnapshotManifest(this.dependencies.workspaceDir),
      this.dependencies.workspace.listTrackedFiles()
    ])
    if (!manifest || manifest.capturedAt === null) {
      return {
        initialized: false,
        capturedAt: null,
        trackedFileCount: 0,
        // Why no changes before the first capture: nothing has been recorded as
        // a baseline, so every file would read as "added" — rows describing our
        // own missing state rather than anything the user changed.
        changes: []
      }
    }
    return {
      initialized: true,
      capturedAt: manifest.capturedAt,
      trackedFileCount: Object.keys(manifest.files).length,
      changes: await this.computeChanges(manifest, trackedFiles)
    }
  }

  /**
   * Records the current state of every tracked file as the new baseline. Files
   * gone from disk are dropped, so a later revert cannot resurrect them.
   */
  async capture(): Promise<FileSnapshotSummary> {
    const trackedFiles = await this.dependencies.workspace.listTrackedFiles()
    const files: Record<string, string> = {}
    for (const relativePath of trackedFiles) {
      const read = await this.dependencies.workspace.readTextFile(relativePath)
      if (read.kind !== 'text') {
        continue
      }
      files[relativePath] = await this.storeObject(read.content)
    }
    return this.writeManifest({ version: 1, capturedAt: Date.now(), files })
  }

  /** Promotes one file's current content to the baseline, leaving siblings alone. */
  async acceptFile(relativePath: string): Promise<FileSnapshotSummary> {
    const manifest = await this.requireManifest()
    const read = await this.dependencies.workspace.readTextFile(relativePath)
    if (read.kind !== 'text') {
      // Gone from disk: accept the deletion rather than keep a stale baseline.
      delete manifest.files[relativePath]
    } else {
      manifest.files[relativePath] = await this.storeObject(read.content)
    }
    return this.writeManifest({ ...manifest, capturedAt: Date.now() })
  }

  async acceptAll(): Promise<FileSnapshotSummary> {
    await this.requireManifest()
    return this.capture()
  }

  /**
   * Restores one file from its snapshot. A path absent from the manifest was
   * created after the baseline, so reverting means deleting it — writing an
   * empty file would leave a stray artifact the agent never wrote.
   */
  async revertFile(relativePath: string): Promise<FileSnapshotSummary> {
    const manifest = await this.requireManifest()
    const hash = manifest.files[relativePath]
    if (hash === undefined) {
      await this.dependencies.workspace.deleteFile(relativePath)
      return this.summary()
    }
    const content = await readFileSnapshotObject(this.dependencies.workspaceDir, hash)
    if (content === null) {
      throw new Error(`Snapshot content for ${relativePath} is missing from the store`)
    }
    await this.dependencies.workspace.writeTextFile(relativePath, content)
    return this.summary()
  }

  async revertAll(): Promise<FileSnapshotSummary> {
    const manifest = await this.requireManifest()
    const trackedFiles = await this.dependencies.workspace.listTrackedFiles()
    const changes = await this.computeChanges(manifest, trackedFiles)
    for (const change of changes) {
      await this.revertFile(change.relativePath)
    }
    return this.summary()
  }

  /** Both sides of a file's comparison; a missing side is '' and never a throw. */
  async content(relativePath: string): Promise<FileSnapshotContent> {
    const manifest = await readFileSnapshotManifest(this.dependencies.workspaceDir)
    const hash = manifest?.files[relativePath]
    const snapshotContent =
      hash === undefined ? null : await readFileSnapshotObject(this.dependencies.workspaceDir, hash)
    const read = await this.dependencies.workspace.readTextFile(relativePath)
    return {
      original: snapshotContent?.toString('utf8') ?? '',
      // Why '' rather than an error: the panel needs to say "cannot compare
      // this" once, not fail the whole file list because one file is an image.
      modified: read.kind === 'text' ? read.content.toString('utf8') : '',
      // Binary/oversized on the current side, while the snapshot side has text
      // to show: the comparison is real but partial, so say so instead of
      // rendering an empty right pane as if the file were emptied.
      binary: snapshotContent !== null && read.kind !== 'text'
    }
  }

  private async storeObject(content: Buffer): Promise<string> {
    const hash = hashFileSnapshotContent(content)
    await writeFileSnapshotObject(this.dependencies.workspaceDir, hash, content)
    return hash
  }

  private async writeManifest(manifest: FileSnapshotManifest): Promise<FileSnapshotSummary> {
    await writeFileSnapshotManifest(this.dependencies.workspaceDir, manifest)
    return {
      initialized: true,
      capturedAt: manifest.capturedAt,
      trackedFileCount: Object.keys(manifest.files).length,
      changes: []
    }
  }

  private async requireManifest(): Promise<FileSnapshotManifest> {
    const manifest = await readFileSnapshotManifest(this.dependencies.workspaceDir)
    if (!manifest || manifest.capturedAt === null) {
      throw new Error('This workspace has no snapshot baseline yet')
    }
    return manifest
  }

  private async computeChanges(
    manifest: FileSnapshotManifest,
    trackedFiles: string[]
  ): Promise<FileSnapshotChange[]> {
    const tracked = new Set(trackedFiles)
    const changes: FileSnapshotChange[] = []
    for (const relativePath of trackedFiles) {
      const read = await this.dependencies.workspace.readTextFile(relativePath)
      const hash = manifest.files[relativePath]
      if (hash === undefined) {
        if (read.kind !== 'text') {
          continue
        }
        const { additions } = countFileSnapshotLineChanges(null, read.content)
        changes.push({ relativePath, status: 'added', additions, deletions: 0 })
        continue
      }
      if (read.kind !== 'text') {
        // Unreadable now but recorded before. Report as deleted rather than
        // modified: offering a revert is only safe when the file is gone.
        changes.push({ relativePath, status: 'deleted', additions: 0, deletions: 0 })
        continue
      }
      if (hashFileSnapshotContent(read.content) === hash) {
        continue
      }
      const snapshotContent = await readFileSnapshotObject(this.dependencies.workspaceDir, hash)
      const { additions, deletions } = countFileSnapshotLineChanges(snapshotContent, read.content)
      changes.push({ relativePath, status: 'modified', additions, deletions })
    }
    for (const [relativePath, hash] of Object.entries(manifest.files)) {
      if (tracked.has(relativePath)) {
        continue
      }
      // Why the deletion count comes from the snapshot rather than a re-read:
      // the file is gone, so its recorded line count is the only honest source.
      const snapshotContent = await readFileSnapshotObject(this.dependencies.workspaceDir, hash)
      const { deletions } = countFileSnapshotLineChanges(snapshotContent, null)
      changes.push({ relativePath, status: 'deleted', additions: 0, deletions })
    }
    return changes.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  }
}

export function createFileSnapshotEngine(
  target: FileSnapshotTarget,
  store: Store,
  workspaceDir: string
): FileSnapshotEngine {
  return new FileSnapshotEngine({
    workspace: createFileSnapshotWorkspace(target, store),
    workspaceDir
  })
}

export type { FileSnapshotReadResult }