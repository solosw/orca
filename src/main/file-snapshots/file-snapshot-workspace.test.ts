import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FILE_SNAPSHOT_MAX_TEXT_BYTES } from '../../shared/file-snapshot-types'

const { provider, requireProvider } = vi.hoisted(() => {
  const provider = {
    stat: vi.fn(),
    readFile: vi.fn(),
    listFiles: vi.fn(),
    createDir: vi.fn(),
    writeFile: vi.fn(),
    deletePath: vi.fn()
  }
  return { provider, requireProvider: vi.fn(() => provider) }
})

vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  requireSshFilesystemProvider: requireProvider
}))

import { createSshFileSnapshotWorkspace } from './file-snapshot-workspace'

describe('SSH file snapshot workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    provider.stat.mockResolvedValue({
      size: FILE_SNAPSHOT_MAX_TEXT_BYTES,
      type: 'file',
      mtime: 0
    })
    provider.listFiles.mockResolvedValue([])
  })

  it('skips a file that grows past the limit during read', async () => {
    provider.readFile.mockRejectedValue(
      new Error('File too large: 5.1MB exceeds 5MB limit')
    )

    const workspace = createSshFileSnapshotWorkspace('/remote/repo', 'connection-1')

    await expect(workspace.readTextFile('src/growing.ts')).resolves.toEqual({
      kind: 'oversized'
    })
  })
})
