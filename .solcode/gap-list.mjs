import fs from 'node:fs'
import path from 'node:path'

const target = 'C:\\software\\projects\\orca'
const donor = 'C:\\$Recycle.Bin\\S-1-5-21-3298863429-323757206-1539849354-1004\\$RXJIAKQ'

const out = []
const log = (s) => out.push(s)

// List donor files (excluding heavy/irrelevant trees).
const SKIP_TOP = new Set(['node_modules', 'out', 'dist', 'build', '.git'])
function listFiles(root) {
  const files = []
  const walk = (dir, prefix) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (prefix === '' && SKIP_TOP.has(e.name)) continue
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, rel)
      } else {
        files.push(rel)
      }
    }
  }
  walk(root, '')
  return files
}

const donorFiles = listFiles(donor)
log(`donor files (excl. .git/node_modules/out/dist/build): ${donorFiles.length}`)

let missing = 0
let present = 0
const missingList = []
for (const rel of donorFiles) {
  const dest = path.join(target, rel.split('/').join(path.sep))
  if (fs.existsSync(dest)) {
    present += 1
  } else {
    missing += 1
    missingList.push(rel)
  }
}

log(`present in restored tree: ${present}`)
log(`MISSING from restored tree: ${missing}`)
log('')
log('=== missing, grouped by top-level dir ===')
const groups = new Map()
for (const rel of missingList) {
  const seg = rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '(root file)'
  groups.set(seg, (groups.get(seg) ?? 0) + 1)
}
for (const [g, n] of [...groups.entries()].sort((a, b) => b[1] - a[1])) {
  log(`  ${g}: ${n}`)
}

log('')
log('=== src/main/agent-hooks specifically ===')
const ahMissing = missingList.filter((r) => r.startsWith('src/main/agent-hooks/'))
log(`  missing count: ${ahMissing.length}`)
log('  sample: ' + ahMissing.slice(0, 8).join(', '))

log('')
log('=== is the donor the same commit as the snapshot? compare a shared file ===')
import('node:crypto').then(({ createHash }) => {
  const probeRel = 'src/shared/tui-agent.ts'
  const a = path.join(donor, probeRel.split('/').join(path.sep))
  const b = path.join(target, probeRel.split('/').join(path.sep))
  const ha = fs.existsSync(a) ? createHash('sha256').update(fs.readFileSync(a)).digest('hex').slice(0, 16) : 'n/a'
  const hb = fs.existsSync(b) ? createHash('sha256').update(fs.readFileSync(b)).digest('hex').slice(0, 16) : 'n/a'
  log(`  donor  ${probeRel}: ${ha}`)
  log(`  target ${probeRel}: ${hb}`)
  log(`  identical: ${ha === hb}`)

  fs.writeFileSync('.solcode/gap-list.txt', out.join('\n') + '\n\n=== full missing list ===\n' + missingList.join('\n'))
  console.log(out.join('\n'))
})