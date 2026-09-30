// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { FileSnapshotChange, FileSnapshotSummary } from '../../../../shared/file-snapshot-types'
import type { FileSnapshotsState } from './use-file-snapshots'

const useFileSnapshotsMock = vi.fn<() => FileSnapshotsState>()
const openFileSnapshotDiffMock = vi.fn()

vi.mock('./use-file-snapshots', () => ({
  useFileSnapshots: () => useFileSnapshotsMock()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { openFileSnapshotDiff: typeof openFileSnapshotDiffMock }) => unknown) =>
    selector({ openFileSnapshotDiff: openFileSnapshotDiffMock })
}))

vi.mock('@/store/selectors', () => ({
  useActiveWorktreeId: () => 'wt-1'
}))

import FileSnapshotsPanel from './FileSnapshotsPanel'

function change(
  relativePath: string,
  status: FileSnapshotChange['status'] = 'modified'
): FileSnapshotChange {
  return { relativePath, status, additions: 2, deletions: 1 }
}

function summary(changes: FileSnapshotChange[]): FileSnapshotSummary {
  return {
    initialized: true,
    capturedAt: 1,
    trackedFileCount: changes.length,
    changes
  }
}

function mockState(overrides: Partial<FileSnapshotsState> = {}): FileSnapshotsState {
  return {
    target: { workspacePath: 'C:/repo' },
    summary: summary([
      change('src/a/one.ts'),
      change('src/a/two.ts'),
      change('README.md', 'added')
    ]),
    loading: false,
    error: null,
    refreshing: false,
    acceptFile: vi.fn(async () => undefined),
    acceptFiles: vi.fn(async () => undefined),
    revertFile: vi.fn(async () => undefined),
    revertFiles: vi.fn(async () => undefined),
    acceptAll: vi.fn(async () => undefined),
    revertAll: vi.fn(async () => undefined),
    capture: vi.fn(async () => undefined),
    rebuild: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...overrides
  }
}

describe('FileSnapshotsPanel tree view', () => {
  beforeEach(() => {
    useFileSnapshotsMock.mockReset()
    openFileSnapshotDiffMock.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nested changes as a collapsible tree', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    useFileSnapshotsMock.mockReturnValue(mockState())
    render(
      <TooltipProvider>
        <FileSnapshotsPanel />
      </TooltipProvider>
    )

    expect(screen.getByText('src/a')).toBeTruthy()
    expect(screen.getByText('one.ts')).toBeTruthy()
    expect(screen.getByText('two.ts')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Toggle folder' }))
    expect(screen.queryByText('one.ts')).toBeNull()
    expect(screen.queryByText('two.ts')).toBeNull()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('keeps or reverts every file under a folder row', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    const state = mockState()
    useFileSnapshotsMock.mockReturnValue(state)
    render(
      <TooltipProvider>
        <FileSnapshotsPanel />
      </TooltipProvider>
    )

    await user.click(
      screen.getByRole('button', { name: 'Keep all changes in this folder' })
    )
    expect(state.acceptFiles).toHaveBeenCalledWith(['src/a/one.ts', 'src/a/two.ts'])

    await user.click(
      screen.getByRole('button', { name: 'Revert all files in this folder' })
    )
    expect(state.revertFiles).toHaveBeenCalledWith(['src/a/one.ts', 'src/a/two.ts'])
  })

  it('opens a snapshot comparison as an in-window editor tab', async () => {
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()
    useFileSnapshotsMock.mockReturnValue(mockState())
    render(
      <TooltipProvider>
        <FileSnapshotsPanel />
      </TooltipProvider>
    )

    await user.click(screen.getByText('README.md'))
    expect(openFileSnapshotDiffMock).toHaveBeenCalledWith(
      'wt-1',
      'README.md',
      'markdown',
      { workspacePath: 'C:/repo' },
      { preview: true }
    )
  })
})
