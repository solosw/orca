import fs from 'node:fs'
import path from 'node:path'

console.log('=== fixed drives ===')
const drives = []
for (const letter of 'CDEFGH'.split('')) {
  if (fs.existsSync(`${letter}:\\`)) drives.push(`${letter}:\\`)
}
console.log('  ' + drives.join(', '))

console.log('')
console.log('=== search each drive (depth 3) for a dir named orca* ===')
const SKIP = new Set([
  'node_modules', '$Recycle.Bin', 'Windows', 'Program Files', 'Program Files (x86)',
  'ProgramData', 'AppData', 'System Volume Information', '.git', 'dist', 'out'
])
const found = []
for (const drive of drives) {
  walk(drive, 0)
}
function walk(dir, depth) {
  if (depth > 3) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (SKIP.has(e.name)) continue
    if (/^orca/i.test(e.name)) {
      const full = path.join(dir, e.name)
      let count = 'ERR'
      try {
        count = fs.readdirSync(full).length
      } catch {}
      found.push(`${full} (children=${count})`)
    }
    walk(path.join(dir, e.name), depth + 1)
  }
}
console.log(found.length ? found.map((f) => '  ' + f).join('\n') : '  (none named orca*)')

console.log('')
console.log('=== VSCode local history (recovery source) ===')
const vscHistory = 'C:\\Users\\solosw\\AppData\\Roaming\\Code\\User\\History'
if (fs.existsSync(vscHistory)) {
  const dirs = fs.readdirSync(vscHistory)
  console.log(`  entries: ${dirs.length}`)
  // Look for entries.json mentioning orca paths.
  let orcaMentions = 0
  for (const d of dirs.slice(0, 4000)) {
    const ej = path.join(vscHistory, d, 'entries.json')
    if (!fs.existsSync(ej)) continue
    try {
      if (fs.readFileSync(ej, 'utf8').includes('projects/orca') || fs.readFileSync(ej, 'utf8').includes('projects\\\\orca')) {
        orcaMentions += 1
      }
    } catch {}
  }
  console.log(`  history entries referencing projects/orca: ${orcaMentions}`)
} else {
  console.log('  no history dir')
}