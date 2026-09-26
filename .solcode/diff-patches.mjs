import fs from 'node:fs'
import path from 'node:path'

const restored = 'C:\\software\\projects\\orca'
const donor = 'C:\\$Recycle.Bin\\S-1-5-21-3298863429-323757206-1539849354-1004\\$RXJIAKQ'

const out = []
const log = (s) => out.push(s)

// Recursively list a directory as relative-path -> size.
function listing(root) {
  const map = new Map()
  const walk = (dir, prefix) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, rel)
      } else {
        try {
          map.set(rel, fs.statSync(full).size)
        } catch {}
      }
    }
  }
  walk(root, '')
  return map
}

log('=== config/patches: donor vs restored ===')
const donorPatches = listing(path.join(donor, 'config', 'patches'))
const restoredPatches = listing(path.join(restored, 'config', 'patches'))

log(`donor files: ${donorPatches.size}`)
log(`restored files: ${restoredPatches.size}`)

log('')
log('=== files in donor that are MISSING or SIZE-DIFFERENT in restored ===')
const fixes = []
for (const [rel, size] of donorPatches) {
  const have = restoredPatches.get(rel)
  if (have === undefined) {
    fixes.push({ rel, size, why: 'missing' })
  } else if (have !== size) {
    fixes.push({ rel, size, have, why: 'size-differs' })
  }
}
for (const f of fixes) {
  log(`  ${f.why}: ${f.rel}  donor=${f.size}${f.have !== undefined ? ` restored=${f.have}` : ''}`)
}
if (!fixes.length) log('  (none)')

log('')
log('=== files only in restored (should not be overwritten) ===')
for (const [rel] of restoredPatches) {
  if (!donorPatches.has(rel)) log(`  restored-only: ${rel}`)
}

// Also check the whole tree for large files the snapshot may have skipped,
// restricted to paths that exist in BOTH (so we compare like with like).
log('')
log('=== whole-tree: donor files > 4MB missing in restored ===')
const donorAll = listing(donor)
let largeMissing = 0
for (const [rel, size] of donorAll) {
  if (size <= 4 * 1024 * 1024) continue
  if (rel.startsWith('node_modules/')) continue
  const full = path.join(restored, rel.split('/').join(path.sep))
  if (!fs.existsSync(full)) {
    largeMissing += 1
    if (largeMissing <= 40) log(`  ${rel}  (${(size / 1048576).toFixed(1)} MB)`)
  }
}
log(`  total large missing: ${largeMissing}`)

fs.writeFileSync('.solcode/diff-patches.txt', out.join('\n'))
console.log(out.join('\n'))