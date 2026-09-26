import type {
  FileSnapshotContent,
  FileSnapshotSummary,
  FileSnapshotTarget
} from '../../shared/file-snapshot-types'

export type FileSnapshotsApi = {
  /** Current baseline state plus everything that differs from it. */
  status: (target: FileSnapshotTarget) => Promise<FileSnapshotSummary>
  /** Records the current workspace state as the new baseline. */
  capture: (target: FileSnapshotTarget) => Promise<FileSnapshotSummary>
  acceptFile: (args: {
    target: FileSnapshotTarget
    relativePath: string
  }) => Promise<FileSnapshotSummary>
  acceptAll: (target: FileSnapshotTarget) => Promise<FileSnapshotSummary>
  revertFile: (args: {
    target: FileSnapshotTarget
    relativePath: string
  }) => Promise<FileSnapshotSummary>
  revertAll: (target: FileSnapshotTarget) => Promise<FileSnapshotSummary>
  /** Snapshot side and current side of one file, for the diff view. */
  content: (args: {
    target: FileSnapshotTarget
    relativePath: string
  }) => Promise<FileSnapshotContent>
}