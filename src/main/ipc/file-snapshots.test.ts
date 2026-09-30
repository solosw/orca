import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FILE_SNAPSHOT_CHANNELS } from '../../shared/file-snapshot-channels'
import type { FileSnapshotSummary } from '../../shared/file-snapshot-types'
import type { Store } from '../persistence'

const handlers = new Map<string, (_event: unknown, args: unknown) => unknown>()
const {
  handleMock,
  removeHandlerMock,
  summaryMock,
  captureMock,
  acceptFileMock,
  acceptFilesMock,
  revertFileMock,
  revertFilesMock,
  contentMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  summaryMock: vi.fn(),
  captureMock: vi.fn(),
  acceptFileMock: vi.fn(),
  acceptFilesMock: vi.fn(),
  revertFileMock: vi.fn(),
  revertFilesMock: vi.fn(),
  contentMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
    removeHandler: removeHandlerMock
  }
}))

vi.mock('../file-snapshots/file-snapshot-engine', () => ({
  createFileSnapshotEngine: vi.fn(() => ({
    summary: summaryMock,
    capture: captureMock,
    acceptFile: acceptFileMock,
    acceptFiles: acceptFilesMock,
    acceptAll: captureMock,
    revertFile: revertFileMock,
    revertFiles: revertFilesMock,
    revertAll: captureMock,
    content: contentMock
  }))
}))

import { registerFileSnapshotHandlers } from './file-snapshots'

const SUMMARY: FileSnapshotSummary = {
  initialized: true,
  capturedAt: 1,
  trackedFileCount: 0,
  changes: []
}

type Handler = (event: unknown, args: unknown) => unknown

function handlerFor(channel: string): Handler {
  const handler = handlers.get(channel)
  if (!handler) {
    throw new Error(`No handler registered for ${channel}`)
  }
  return handler
}

describe('registerFileSnapshotHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    handleMock.mockReset()
    removeHandlerMock.mockReset()
    summaryMock.mockReset().mockResolvedValue(SUMMARY)
    captureMock.mockReset().mockResolvedValue(SUMMARY)
    acceptFileMock.mockReset().mockResolvedValue(SUMMARY)
    acceptFilesMock.mockReset().mockResolvedValue(SUMMARY)
    revertFileMock.mockReset().mockResolvedValue(SUMMARY)
    revertFilesMock.mockReset().mockResolvedValue(SUMMARY)
    contentMock.mockReset().mockResolvedValue({ original: '', modified: '', binary: false })
    handleMock.mockImplementation((channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: createFileSnapshotEngine is mocked above, so the handler never reads this store.
    registerFileSnapshotHandlers({} as Store)
  })

  it('registers every channel and clears stale handlers first', () => {
    for (const channel of Object.values(FILE_SNAPSHOT_CHANNELS)) {
      expect(handlers.has(channel)).toBe(true)
      // Why: registerCoreHandlers can run twice on macOS activate; a second
      // ipcMain.handle on a live channel throws.
      expect(removeHandlerMock).toHaveBeenCalledWith(channel)
    }
  })

  it('rejects a missing or empty workspacePath', async () => {
    // A wholly absent target is rejected by the shape guard...
    await expect(handlerFor(FILE_SNAPSHOT_CHANNELS.status)(null, undefined)).rejects.toThrow(
      /Invalid file snapshot target/
    )
    // ...and an empty path, which would resolve to the filesystem root, by the value guard.
    await expect(
      handlerFor(FILE_SNAPSHOT_CHANNELS.status)(null, { workspacePath: '' })
    ).rejects.toThrow(/workspacePath is required/)
    // Why a numeric path too: it would otherwise reach the engine as a non-string.
    await expect(
      handlerFor(FILE_SNAPSHOT_CHANNELS.status)(null, { workspacePath: 42 })
    ).rejects.toThrow(/workspacePath is required/)
  })

  it('rejects a non-string connectionId rather than falling back to local', async () => {
    // Why: coercing this to undefined would point a remote workspace's snapshot
    // at a local path that means a different file entirely.
    await expect(
      handlerFor(FILE_SNAPSHOT_CHANNELS.status)(null, {
        workspacePath: '/repo',
        connectionId: 7
      })
    ).rejects.toThrow(/connectionId must be a string/)
  })

  it('accepts a local target with no connectionId', async () => {
    await expect(
      handlerFor(FILE_SNAPSHOT_CHANNELS.status)(null, { workspacePath: '/repo' })
    ).resolves.toEqual(SUMMARY)
    expect(summaryMock).toHaveBeenCalledTimes(1)
  })

  it('rejects absolute and traversal relative paths before reaching the engine', async () => {
    const channel = FILE_SNAPSHOT_CHANNELS.acceptFile
    for (const relativePath of ['/etc/passwd', 'C:/Windows/system32', '../outside.ts', 'a/../../b.ts']) {
      await expect(
        handlerFor(channel)(null, { target: { workspacePath: '/repo' }, relativePath })
      ).rejects.toThrow(/relativePath/)
    }
    expect(acceptFileMock).not.toHaveBeenCalled()
  })

  it('forwards a valid acceptFile to the engine with the parsed path', async () => {
    await handlerFor(FILE_SNAPSHOT_CHANNELS.acceptFile)(null, {
      target: { workspacePath: '/repo' },
      relativePath: 'src/app.ts'
    })
    expect(acceptFileMock).toHaveBeenCalledWith('src/app.ts')
  })

  it('forwards bulk acceptFiles and rejects bad path lists', async () => {
    await handlerFor(FILE_SNAPSHOT_CHANNELS.acceptFiles)(null, {
      target: { workspacePath: '/repo' },
      relativePaths: ['src/a.ts', 'src/b.ts']
    })
    expect(acceptFilesMock).toHaveBeenCalledWith(['src/a.ts', 'src/b.ts'])

    await expect(
      handlerFor(FILE_SNAPSHOT_CHANNELS.acceptFiles)(null, {
        target: { workspacePath: '/repo' },
        relativePaths: ['../escape.ts']
      })
    ).rejects.toThrow(/relativePath/)
    expect(acceptFilesMock).toHaveBeenCalledTimes(1)
  })

  it('forwards a valid revertFile to the engine', async () => {
    await handlerFor(FILE_SNAPSHOT_CHANNELS.revertFile)(null, {
      target: { workspacePath: '/repo' },
      relativePath: 'src/app.ts'
    })
    expect(revertFileMock).toHaveBeenCalledWith('src/app.ts')
  })

  it('forwards bulk revertFiles to the engine', async () => {
    await handlerFor(FILE_SNAPSHOT_CHANNELS.revertFiles)(null, {
      target: { workspacePath: '/repo' },
      relativePaths: ['src/a.ts', 'src/b.ts']
    })
    expect(revertFilesMock).toHaveBeenCalledWith(['src/a.ts', 'src/b.ts'])
  })

  it('forwards content requests with the parsed path', async () => {
    await handlerFor(FILE_SNAPSHOT_CHANNELS.content)(null, {
      target: { workspacePath: '/repo' },
      relativePath: 'README.md'
    })
    expect(contentMock).toHaveBeenCalledWith('README.md')
  })

  it('propagates engine failures to the renderer', async () => {
    summaryMock.mockRejectedValueOnce(new Error('baseline missing'))
    await expect(
      handlerFor(FILE_SNAPSHOT_CHANNELS.status)(null, { workspacePath: '/repo' })
    ).rejects.toThrow('baseline missing')
  })
})