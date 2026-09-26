import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { gzipSync, gunzipSync } from 'node:zlib'
import { fileSnapshotObjectPath } from './file-snapshot-paths'

/**
 * Content-addressed object store for file snapshots: every distinct file
 * revision is written once under the SHA-256 of its bytes, so re-snapshotting a
 * file that did not change costs nothing and two files with identical contents
 * share one object.
 */
export function hashFileSnapshotContent(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

async function hasFileSnapshotObject(workspaceDir: string, hash: string): Promise<boolean> {
  try {
    await stat(fileSnapshotObjectPath(workspaceDir, hash))
    return true
  } catch {
    return false
  }
}

/**
 * Writes the object unless it already exists. Why the temp-then-rename dance:
 * a process killed mid-write would otherwise leave a truncated object that every
 * later read treats as the real (and wrong) content for that hash.
 */
export async function writeFileSnapshotObject(
  workspaceDir: string,
  hash: string,
  content: Buffer
): Promise<void> {
  const objectPath = fileSnapshotObjectPath(workspaceDir, hash)
  if (await hasFileSnapshotObject(workspaceDir, hash)) {
    return
  }
  await mkdir(dirname(objectPath), { recursive: true })
  const tempPath = `${objectPath}.${process.pid}.${Date.now()}.tmp`
  let renamed = false
  try {
    // Why gzip: snapshot objects are the bulk of this feature's disk use and
    // the common case — source text — compresses several-fold.
    await writeFile(tempPath, gzipSync(content), { mode: 0o600 })
    await rename(tempPath, objectPath)
    renamed = true
  } finally {
    if (!renamed) {
      await rm(tempPath, { force: true }).catch(() => {})
    }
  }
}

/** Returns null when the object is absent or unreadable, so a pruned store degrades to "no snapshot". */
export async function readFileSnapshotObject(
  workspaceDir: string,
  hash: string
): Promise<Buffer | null> {
  try {
    const raw = await readFile(fileSnapshotObjectPath(workspaceDir, hash))
    return gunzipSync(raw)
  } catch {
    return null
  }
}