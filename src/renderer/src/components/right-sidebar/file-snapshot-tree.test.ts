import { describe, expect, it } from 'vitest'
import type { FileSnapshotChange } from '../../../../shared/file-snapshot-types'
import {
  buildFileSnapshotTree,
  collectFileSnapshotPaths,
  flattenFileSnapshotTree
} from './file-snapshot-tree'

function change(
  relativePath: string,
  status: FileSnapshotChange['status'] = 'modified'
): FileSnapshotChange {
  return { relativePath, status, additions: 1, deletions: 0 }
}

describe('file-snapshot-tree', () => {
  it('compacts single-child directory chains and keeps files under folders', () => {
    const roots = buildFileSnapshotTree([
      change('src/a/b/one.ts'),
      change('src/a/b/two.ts'),
      change('README.md', 'added')
    ])

    expect(roots.map((node) => node.name)).toEqual(['src/a/b', 'README.md'])
    const folder = roots[0]
    expect(folder?.type).toBe('directory')
    if (folder?.type !== 'directory') {
      throw new Error('expected compacted directory')
    }
    expect(folder.fileCount).toBe(2)
    expect(folder.children.map((child) => child.name)).toEqual(['one.ts', 'two.ts'])
  })

  it('hides descendants when a directory is collapsed', () => {
    const roots = buildFileSnapshotTree([
      change('src/a/one.ts'),
      change('src/a/two.ts'),
      change('root.ts')
    ])
    const folder = roots.find((node) => node.type === 'directory')
    expect(folder?.type).toBe('directory')
    if (folder?.type !== 'directory') {
      throw new Error('expected directory')
    }

    const collapsed = flattenFileSnapshotTree(roots, new Set([folder.key]))
    expect(collapsed.map((node) => node.name)).toEqual([folder.name, 'root.ts'])
  })

  it('collects every file path under a directory for bulk keep/revert', () => {
    const roots = buildFileSnapshotTree([
      change('src/a/one.ts'),
      change('src/a/nested/two.ts'),
      change('README.md', 'added')
    ])
    const folder = roots.find((node) => node.type === 'directory')
    expect(folder?.type).toBe('directory')
    if (folder?.type !== 'directory') {
      throw new Error('expected directory')
    }

    expect(collectFileSnapshotPaths(folder)).toEqual(['src/a/nested/two.ts', 'src/a/one.ts'])
  })
})
