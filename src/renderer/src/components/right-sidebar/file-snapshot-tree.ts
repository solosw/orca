import { compareFileNames } from '../../../../shared/file-name-sort'
import type { FileSnapshotChange } from '../../../../shared/file-snapshot-types'
import {
  buildSourceControlTree,
  compactSourceControlTree,
  flattenSourceControlTree,
  type SourceControlTreeNode
} from './source-control-tree'

export type FileSnapshotTreeEntry = {
  path: string
  change: FileSnapshotChange
}

export type FileSnapshotTreeNode = SourceControlTreeNode<FileSnapshotTreeEntry, 'snapshot'>

function toTreeEntry(change: FileSnapshotChange): FileSnapshotTreeEntry {
  return {
    path: change.relativePath,
    change
  }
}

export function buildFileSnapshotTree(
  changes: readonly FileSnapshotChange[]
): FileSnapshotTreeNode[] {
  const entries = [...changes]
    .map(toTreeEntry)
    .sort((left, right) => compareFileNames(left.path, right.path))
  return compactSourceControlTree(
    buildSourceControlTree('snapshot', entries, (left, right) =>
      compareFileNames(left.path, right.path)
    )
  )
}

export function flattenFileSnapshotTree(
  nodes: readonly FileSnapshotTreeNode[],
  collapsedDirectoryKeys: ReadonlySet<string>
): FileSnapshotTreeNode[] {
  return flattenSourceControlTree(nodes, collapsedDirectoryKeys)
}

/** Collects every changed file path under a directory node, depth-first. */
export function collectFileSnapshotPaths(
  node: Extract<FileSnapshotTreeNode, { type: 'directory' }>
): string[] {
  const paths: string[] = []
  const visit = (current: FileSnapshotTreeNode): void => {
    if (current.type === 'file') {
      paths.push(current.entry.change.relativePath)
      return
    }
    for (const child of current.children) {
      visit(child)
    }
  }
  visit(node)
  return paths
}
