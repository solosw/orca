import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { FILE_SNAPSHOT_MAX_TRACKED_FILES } from '../../shared/file-snapshot-types'
import { fileSnapshotManifestPath } from './file-snapshot-paths'

/**
 * Manifest maps workspace-relative path to the hash of its snapshotted bytes.
 * `capturedAt` is nullable because a malformed or absent field reads as
 * "unknown", never as the epoch.
 */
export type FileSnapshotManifest = {
  version: 1
  capturedAt: number | null
  files: Record<string, string>
}

export async function readFileSnapshotManifest(
  workspaceDir: string
): Promise<FileSnapshotManifest | null> {
  try {
    return parseFileSnapshotManifest(await readFile(fileSnapshotManifestPath(workspaceDir), 'utf8'))
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectManifestHashes(files: Record<string, unknown>): Record<string, string> {
  const hashes: Record<string, string> = {}
  for (const [path, hash] of Object.entries(files)) {
    // A SHA-256 hex digest is exactly 64 chars; anything else is a corrupt entry.
    if (typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) {
      hashes[path] = hash
    }
  }
  return hashes
}

/**
 * Tolerates a malformed or partial manifest by treating it as absent: a store
 * that cannot be read is re-initialized on the next capture, which beats
 * failing every panel open.
 */
export function parseFileSnapshotManifest(raw: string): FileSnapshotManifest | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !isRecord(parsed.files)) {
    return null
  }
  return {
    version: 1,
    capturedAt: typeof parsed.capturedAt === 'number' ? parsed.capturedAt : null,
    files: collectManifestHashes(parsed.files)
  }
}

export async function writeFileSnapshotManifest(
  workspaceDir: string,
  manifest: FileSnapshotManifest
): Promise<void> {
  const entries = Object.entries(manifest.files)
  // Why a hard cap: the manifest is read whole on every list, so an
  // accidentally-huge generated tree must not turn the panel into an OOM.
  // Sorting before the cut keeps the retained subset deterministic, so the same
  // workspace always keeps the same files.
  const files =
    entries.length > FILE_SNAPSHOT_MAX_TRACKED_FILES
      ? Object.fromEntries(
          entries
            .sort(([left], [right]) => left.localeCompare(right))
            .slice(0, FILE_SNAPSHOT_MAX_TRACKED_FILES)
        )
      : manifest.files
  const manifestPath = fileSnapshotManifestPath(workspaceDir)
  await mkdir(workspaceDir, { recursive: true })
  const tempPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`
  let renamed = false
  try {
    await writeFile(tempPath, `${JSON.stringify({ ...manifest, files }, null, 2)}\n`, { mode: 0o600 })
    await rename(tempPath, manifestPath)
    renamed = true
  } finally {
    if (!renamed) {
      await rm(tempPath, { force: true }).catch(() => {})
    }
  }
}

/** Drops a workspace's snapshot store entirely, for worktree removal. */
export async function deleteFileSnapshotStore(workspaceDir: string): Promise<void> {
  await rm(workspaceDir, { recursive: true, force: true }).catch(() => {})
}