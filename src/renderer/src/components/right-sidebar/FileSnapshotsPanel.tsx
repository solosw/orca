import React, { useCallback, useState } from 'react'
import { Check, History, Loader2, RefreshCw, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { FileSnapshotChange, FileSnapshotStatus } from '../../../../shared/file-snapshot-types'
import { STATUS_COLORS, STATUS_LABELS } from './status-display'
import { DiffLineCounts } from './source-control/listing/diff-line-counts'
import { ActionButton } from './source-control/listing/action-button'
import { basename } from '@/lib/path'
import { useFileSnapshots } from './use-file-snapshots'
import { FileSnapshotDiffDialog } from './file-snapshot-diff-dialog'

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

export default function FileSnapshotsPanel(): React.JSX.Element {
  const snapshots = useFileSnapshots()
  const [diffTarget, setDiffTarget] = useState<FileSnapshotChange | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)

  const summary = snapshots.summary
  const changes = summary?.changes ?? []

  // Why a toast rather than a per-row banner: a revert over a dropped SSH
  // connection fails for every file at once, so one message describing the
  // shared cause beats N identical rows.
  const runAction = useCallback(
    async (relativePath: string | null, action: () => Promise<void>): Promise<void> => {
      setBusyPath(relativePath)
      try {
        await action()
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setBusyPath(null)
      }
    },
    []
  )

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
        <ActionButton
          icon={RefreshCw}
          title={translate('auto.components.right.sidebar.FileSnapshotsPanel.refresh', 'Refresh')}
          disabled={snapshots.refreshing}
          onClick={() => void runAction(null, snapshots.refresh)}
        />
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
            {changes.map((change) => {
              const status = SNAPSHOT_STATUS[change.status]
              const busy = busyPath === change.relativePath
              return (
                <div
                  key={change.relativePath}
                  className="group relative flex cursor-pointer items-center gap-1 py-1 pr-3 pl-3 transition-colors hover:bg-accent/40"
                  onClick={() => setDiffTarget(change)}
                >
                  <div className="min-w-0 flex-1 text-xs">
                    <span className="block min-w-0 truncate">
                      <span className="text-foreground">{basename(change.relativePath)}</span>
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
                        void runAction(change.relativePath, () => snapshots.acceptFile(change))
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
                        void runAction(change.relativePath, () => snapshots.revertFile(change))
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="flex gap-2 border-t border-border p-2">
            <Button
              size="xs"
              className="flex-1"
              disabled={busyPath !== null}
              onClick={() => void runAction(null, snapshots.acceptAll)}
            >
              {translate('auto.components.right.sidebar.FileSnapshotsPanel.acceptAll', 'Keep All')}
            </Button>
            <Button
              size="xs"
              variant="ghost"
              className="flex-1"
              disabled={busyPath !== null}
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

      {diffTarget && snapshots.target && (
        <FileSnapshotDiffDialog
          target={snapshots.target}
          change={diffTarget}
          onClose={() => setDiffTarget(null)}
        />
      )}
    </div>
  )
}