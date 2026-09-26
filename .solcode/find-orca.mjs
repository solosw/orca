import fs from 'node:fs'
import path from 'node:path'

// Distinctive files: my own new feature file, plus orca's build entry point.
const MARKERS = [
  path.join('src', 'shared', 'file-snapshot-types.ts'),
  path.join('src', 'main', 'file-snapshots'),
  'electron.vite.config.ts'
]

const ROOTS = ['C:\\software', 'C:\\software\\projects']
const SKIP = new Set(['node_modules', '.pnpm', 'dist', 'out', 'build', '.git', 'AppData'])
const MAX_DEPTH = 4

const hits = []
let visited = 0

function walk(dir, depth) {
  if (depth > MAX_DEPTH) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  visited += 1
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    for (const marker of MARKERS) {
      if (fs.existsSync(path.join(full, marker))) {
        hits.push({ repo: full, marker })
      }
    }
    walk(full, depth + 1)
  }
}

for (const root of ROOTS) walk(root, 0)

console.log(`dirname(s) visited: ${visited}`)
console.log('=== candidate orca checkouts found ===')
if (hits.length === 0) {
  console.log('  (none)')
}
for (const hit of hits) {
  console.log(`  ${hit.repo}  [via ${hit.marker}]`)
}