import React, { Suspense, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { detectLanguage } from '@/lib/language-detect'
import { translate } from '@/i18n/i18n'
import type {
  FileSnapshotChange,
  FileSnapshotContent,
  FileSnapshotTarget
} from '../../../../shared/file-snapshot-types'

const DiffViewer = lazy(() => import('@/components/editor/DiffViewer'))

type ContentState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; content: FileSnapshotContent }

/**
 * Side-by-side comparison of a file against its snapshot. Reuses the editor's
 * DiffViewer rather than a bespoke renderer so snapshot diffs get the same
 * syntax highlighting, word wrap, and large-file fallback as every other diff
 * in the app.
 */
export function FileSnapshotDiffDialog({
  target,
  change,
  onClose
}: {
  target: FileSnapshotTarget
  change: FileSnapshotChange
  onClose: () => void
}): React.JSX.Element {
  const [state, setState] = useState<ContentState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    // Why read on open rather than holding content in the panel: the file may
    // have changed again since the summary was computed, and a stale diff that
    // disagrees with the row the user just clicked is worse than a short wait.
    void window.api.fileSnapshots
      .content({ target, relativePath: change.relativePath })
      .then((content) => {
        if (!cancelled) {
          setState({ kind: 'ready', content })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [target, change.relativePath])

  const language = detectLanguage(change.relativePath)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[80vh] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.right.sidebar.FileSnapshotDiffDialog.title',
              'Snapshot comparison'
            )}
          </DialogTitle>
          <DialogDescription>{change.relativePath}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {state.kind === 'loading' ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              {translate(
                'auto.components.right.sidebar.FileSnapshotDiffDialog.loading',
                'Loading comparison...'
              )}
            </div>
          ) : state.kind === 'error' ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.FileSnapshotDiffDialog.error',
                'Could not load the comparison: {{message}}',
                { message: state.message }
              )}
            </div>
          ) : state.content.binary ? (
            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.FileSnapshotDiffDialog.binary',
                'This file is binary or too large to compare as text.'
              )}
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {translate(
                    'auto.components.right.sidebar.FileSnapshotDiffDialog.loadingViewer',
                    'Loading viewer...'
                  )}
                </div>
              }
            >
              <div className="flex h-full min-h-0 flex-col">
                <DiffViewer
                  modelKey={`file-snapshot:${target.connectionId ?? 'local'}:${target.workspacePath}:${change.relativePath}`}
                  originalContent={state.content.original}
                  modifiedContent={state.content.modified}
                  language={language}
                  filePath={change.relativePath}
                  relativePath={change.relativePath}
                  sideBySide
                />
              </div>
            </Suspense>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}