import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { gzip, gunzip } from 'node:zlib'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)
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
  const tempPath = `${objectPath}.${process.pid}.${randomUUID()}.tmp`
  let renamed = false
  try {
    // Why gzip: snapshot objects are the bulk of this feature's disk use and
    // the common case — source text — compresses several-fold.
    await writeFile(tempPath, await gzipAsync(content), { mode: 0o600 })
    try {
      await rename(tempPath, objectPath)
      renamed = true
    } catch (error: unknown) {
      // Another concurrent worker may have published the same content hash.
      // The content-addressed winner is valid; discard only this temp file.
      if (await hasFileSnapshotObject(workspaceDir, hash)) {
        renamed = true
        return
      }
      throw error
    }
  } finally {
    if (!renamed) {
      await rm(tempPath, { force: true }).catch(() => {})
    }
  }
}

export async function pruneFileSnapshotObjects(
  workspaceDir: string,
  referencedHashes: ReadonlySet<string>
): Promise<void> {
  const objectsDir = join(workspaceDir, 'objects')
  let buckets
  try {
    buckets = await readdir(objectsDir, { withFileTypes: true })
  } catch {
    return
  }
  await Promise.all(
    buckets
      .filter((bucket) => bucket.isDirectory())
      .map(async (bucket) => {
        const entries = await readdir(join(objectsDir, bucket.name), { withFileTypes: true })
        await Promise.all(
          entries
            .filter((entry) => entry.isFile())
            .filter((entry) => !referencedHashes.has(`${bucket.name}${entry.name}`))
            .map((entry) => rm(join(objectsDir, bucket.name, entry.name), { force: true }))
        )
      })
  )
}

export async function clearFileSnapshotObjects(workspaceDir: string): Promise<void> {
  await rm(join(workspaceDir, 'objects'), { recursive: true, force: true })
}

export async function readFileSnapshotObject(
  workspaceDir: string,
  hash: string
): Promise<Buffer | null> {
  try {
    const raw = await readFile(fileSnapshotObjectPath(workspaceDir, hash))
    return await gunzipAsync(raw)
  } catch {
    return null
  }
}