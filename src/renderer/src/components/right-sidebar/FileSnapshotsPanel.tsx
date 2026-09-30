import React, { useCallback, useMemo, useState } from 'react'
import { Check, ChevronDown, Folder, FolderOpen, History, Loader2, RefreshCw, RotateCcw, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { detectLanguage } from '@/lib/language-detect'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import { useAppStore } from '@/store'
import { useActiveWorktreeId } from '@/store/selectors'
import type { FileSnapshotChange, FileSnapshotStatus } from '../../../../shared/file-snapshot-types'
import { STATUS_COLORS, STATUS_LABELS } from './status-display'
import { DiffLineCounts } from './source-control/listing/diff-line-counts'
import { ActionButton } from './source-control/listing/action-button'
import {
  SOURCE_CONTROL_TREE_DIRECTORY_PADDING_PX,
  SOURCE_CONTROL_TREE_FILE_PADDING_PX,
  SOURCE_CONTROL_TREE_INDENT_PX
} from './source-control/listing/row-layout'
import { useFileSnapshots } from './use-file-snapshots'
import {
  buildFileSnapshotTree,
  collectFileSnapshotPaths,
  flattenFileSnapshotTree,
  type FileSnapshotTreeNode
} from './file-snapshot-tree'

// Why map onto the git file-status vocabulary instead of new colors: the
// sidebar already has an approved light/dark palette for exactly these three
// states, and inventing a parallel set would drift from it.
const SNAPSHOT_STATUS: Record<FileSnapshotStatus, 'added' | 'modified' | 'deleted'> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted'
}

function statusLabel(status: FileSnapshotStatus): string {
  switch (status) {
    case 'added':
      return translate('auto.components.right.sidebar.FileSnapshotsPanel.statusAdded', 'Added')
    case 'modified':
      return translate('auto.components.right.sidebar.FileSnapshotsPanel.statusModified', 'Modified')
    case 'deleted':
      return translate('auto.components.right.sidebar.FileSnapshotsPanel.statusDeleted', 'Deleted')
  }
}

function FileSnapshotDirectoryRow({
  node,
  isCollapsed,
  busy,
  onToggle,
  onAccept,
  onRevert
}: {
  node: Extract<FileSnapshotTreeNode, { type: 'directory' }>
  isCollapsed: boolean
  busy: boolean
  onToggle: () => void
  onAccept: () => void
  onRevert: () => void
}): React.JSX.Element {
  return (
    <div
      className="group relative flex w-full items-center gap-1 pr-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      style={{
        paddingLeft: `${node.depth * SOURCE_CONTROL_TREE_INDENT_PX + SOURCE_CONTROL_TREE_DIRECTORY_PADDING_PX}px`
      }}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1 text-left"
        onClick={onToggle}
        aria-expanded={!isCollapsed}
        aria-label={translate(
          'auto.components.right.sidebar.FileSnapshotsPanel.toggleFolder',
          'Toggle folder'
        )}
      >
        <ChevronDown
          className={cn('size-3 shrink-0 transition-transform', isCollapsed && '-rotate-90')}
        />
        {isCollapsed ? (
          <Folder className="size-3 shrink-0" />
        ) : (
          <FolderOpen className="size-3 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      <span className="w-4 shrink-0 text-center text-[10px] font-bold tabular-nums text-muted-foreground/80">
        {node.fileCount}
      </span>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <ActionButton
          icon={Check}
          disabled={busy}
          title={translate(
            'auto.components.right.sidebar.FileSnapshotsPanel.acceptFolder',
            'Keep all changes in this folder'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onAccept()
          }}
        />
        <ActionButton
          icon={Undo2}
          disabled={busy}
          title={translate(
            'auto.components.right.sidebar.FileSnapshotsPanel.revertFolder',
            'Revert all files in this folder'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onRevert()
          }}
        />
      </div>
    </div>
  )
}

function FileSnapshotFileRow({
  node,
  busy,
  onOpen,
  onAccept,
  onRevert
}: {
  node: Extract<FileSnapshotTreeNode, { type: 'file' }>
  busy: boolean
  onOpen: () => void
  onAccept: () => void
  onRevert: () => void
}): React.JSX.Element {
  const change = node.entry.change
  const status = SNAPSHOT_STATUS[change.status]
  const FileIcon = getFileTypeIcon(change.relativePath)

  return (
    <div
      className="group relative flex cursor-pointer items-center gap-1 py-1 pr-3 transition-colors hover:bg-accent/40"
      style={{
        paddingLeft: `${node.depth * SOURCE_CONTROL_TREE_INDENT_PX + SOURCE_CONTROL_TREE_FILE_PADDING_PX}px`
      }}
      onClick={onOpen}
    >
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 text-xs">
        <span className="block min-w-0 truncate">
          <span className="text-foreground">{node.name}</span>
        </span>
      </div>
      <DiffLineCounts added={change.additions} removed={change.deletions} />
      <span
        className="w-4 shrink-0 text-center text-[10px] font-bold"
        style={{ color: STATUS_COLORS[status] }}
        title={statusLabel(change.status)}
      >
        {STATUS_LABELS[status]}
      </span>
      {/* Why no disabled prop for the busy row: a disabled button
          swallows the Radix tooltip, and ActionButton already
          no-ops when disabled. */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <ActionButton
          icon={Check}
          disabled={busy}
          title={translate(
            'auto.components.right.sidebar.FileSnapshotsPanel.accept',
            'Keep this change'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onAccept()
          }}
        />
        <ActionButton
          icon={Undo2}
          disabled={busy}
          title={translate(
            'auto.components.right.sidebar.FileSnapshotsPanel.revert',
            'Revert this file'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onRevert()
          }}
        />
      </div>
    </div>
  )
}

export default function FileSnapshotsPanel(): React.JSX.Element {
  const snapshots = useFileSnapshots()
  const openFileSnapshotDiff = useAppStore((state) => state.openFileSnapshotDiff)
  const activeWorktreeId = useActiveWorktreeId()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set())

  const summary = snapshots.summary
  const changes = summary?.changes ?? []
  const treeRoots = useMemo(() => buildFileSnapshotTree(changes), [changes])
  const treeRows = useMemo(
    () => flattenFileSnapshotTree(treeRoots, collapsedDirs),
    [collapsedDirs, treeRoots]
  )

  const openSnapshotDiff = useCallback(
    (change: FileSnapshotChange): void => {
      if (!snapshots.target || !activeWorktreeId) {
        return
      }
      // Why an editor-family tab rather than a dialog: Source Control already opens
      // diffs in the main pane, and the snapshot dialog was too small for review.
      openFileSnapshotDiff(
        activeWorktreeId,
        change.relativePath,
        detectLanguage(change.relativePath),
        {
          workspacePath: snapshots.target.workspacePath,
          ...(snapshots.target.workspaceId ? { workspaceId: snapshots.target.workspaceId } : {}),
          ...(snapshots.target.connectionId ? { connectionId: snapshots.target.connectionId } : {})
        },
        { preview: true }
      )
    },
    [activeWorktreeId, openFileSnapshotDiff, snapshots.target]
  )

  // Why a toast rather than a per-row banner: a revert over a dropped SSH
  // connection fails for every file at once, so one message describing the
  // shared cause beats N identical rows.
  const runAction = useCallback(
    async (key: string | null, action: () => Promise<void>): Promise<void> => {
      setBusyKey(key)
      try {
        await action()
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setBusyKey(null)
      }
    },
    []
  )

  const toggleDirectory = useCallback((key: string): void => {
    setCollapsedDirs((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  if (!snapshots.target) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center text-muted-foreground">
        <History size={32} className="mb-3 opacity-50" />
        <p className="text-sm">
          {translate(
            'auto.components.right.sidebar.FileSnapshotsPanel.noWorkspace',
            'No workspace selected'
          )}
        </p>
      </div>
    )
  }

  if (snapshots.loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        <span className="text-sm">
          {translate(
            'auto.components.right.sidebar.FileSnapshotsPanel.loading',
            'Reading snapshots...'
          )}
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {translate('auto.components.right.sidebar.FileSnapshotsPanel.header', 'File Snapshots')}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton
            icon={RotateCcw}
            title={translate('auto.components.right.sidebar.FileSnapshotsPanel.rebuild', 'Clear and rebuild snapshots')}
            disabled={snapshots.refreshing}
            onClick={() => void runAction(null, snapshots.rebuild)}
          />
          <ActionButton
            icon={RefreshCw}
            title={translate('auto.components.right.sidebar.FileSnapshotsPanel.refresh', 'Refresh')}
            disabled={snapshots.refreshing}
            onClick={() => void runAction(null, snapshots.refresh)}
          />
        </div>
      </div>

      {snapshots.error && <p className="border-b border-border px-3 py-2 text-xs text-destructive">{snapshots.error}</p>}

      {!summary?.initialized ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center text-muted-foreground">
          <History size={32} className="mb-3 opacity-50" />
          <p className="text-sm">
            {translate(
              'auto.components.right.sidebar.FileSnapshotsPanel.notInitialized',
              'No baseline yet'
            )}
          </p>
          <p className="mt-1 mb-3 text-xs">
            {translate(
              'auto.components.right.sidebar.FileSnapshotsPanel.notInitializedHint',
              'Take a snapshot to track what changes from here on.'
            )}
          </p>
          <Button size="xs" onClick={() => void runAction(null, snapshots.capture)}>
            {translate(
              'auto.components.right.sidebar.FileSnapshotsPanel.takeSnapshot',
              'Take Snapshot'
            )}
          </Button>
        </div>
      ) : changes.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 text-center text-muted-foreground">
          <Check size={32} className="mb-3 opacity-50" />
          <p className="text-sm">
            {translate(
              'auto.components.right.sidebar.FileSnapshotsPanel.noChanges',
              'No changes since the snapshot'
            )}
          </p>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
            {treeRows.map((node) => {
              if (node.type === 'directory') {
                const folderPaths = collectFileSnapshotPaths(node)
                return (
                  <FileSnapshotDirectoryRow
                    key={node.key}
                    node={node}
                    isCollapsed={collapsedDirs.has(node.key)}
                    busy={busyKey === node.key}
                    onToggle={() => toggleDirectory(node.key)}
                    onAccept={() =>
                      void runAction(node.key, () => snapshots.acceptFiles(folderPaths))
                    }
                    onRevert={() =>
                      void runAction(node.key, () => snapshots.revertFiles(folderPaths))
                    }
                  />
                )
              }

              const change = node.entry.change
              return (
                <FileSnapshotFileRow
                  key={node.key}
                  node={node}
                  busy={busyKey === change.relativePath}
                  onOpen={() => openSnapshotDiff(change)}
                  onAccept={() =>
                    void runAction(change.relativePath, () => snapshots.acceptFile(change))
                  }
                  onRevert={() =>
                    void runAction(change.relativePath, () => snapshots.revertFile(change))
                  }
                />
              )
            })}
          </div>

          <div className="flex gap-2 border-t border-border p-2">
            <Button
              size="xs"
              className="flex-1"
              disabled={busyKey !== null}
              onClick={() => void runAction(null, snapshots.acceptAll)}
            >
              {translate('auto.components.right.sidebar.FileSnapshotsPanel.acceptAll', 'Keep All')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="flex-1"
              disabled={busyKey !== null}
              onClick={() => void runAction(null, snapshots.revertAll)}
            >
              {translate(
                'auto.components.right.sidebar.FileSnapshotsPanel.revertAll',
                'Revert All'
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}