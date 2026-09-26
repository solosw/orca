import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const donor = 'C:\\$Recycle.Bin\\S-1-5-21-3298863429-323757206-1539849354-1004\\$RXJIAKQ'
const target = 'C:\\software\\projects\\orca'

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
      if (e.isDirectory()) walk(full, rel)
      else files.push(rel)
    }
  }
  walk(root, '')
  return files
}

const donorFiles = listFiles(donor)
let copied = 0
let alreadyOk = 0
const failed = []

for (const rel of donorFiles) {
  const from = path.join(donor, rel.split('/').join(path.sep))
  const to = path.join(target, rel.split('/').join(path.sep))
  if (fs.existsSync(to)) {
    alreadyOk += 1
    continue
  }
  try {
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    copied += 1
  } catch (e) {
    failed.push(`${rel}: ${e.code ?? e.message}`)
  }
}

console.log(`donor files: ${donorFiles.length}`)
console.log(`already present: ${alreadyOk}`)
console.log(`copied to fill gaps: ${copied}`)
console.log(`failed: ${failed.length}`)
if (failed.length) console.log(failed.slice(0, 20).join('\n'))

// Verify the whole donor tree is now present.
let stillMissing = 0
for (const rel of donorFiles) {
  if (!fs.existsSync(path.join(target, rel.split('/').join(path.sep)))) stillMissing += 1
}
console.log(`still missing after fill: ${stillMissing}`)

// Re-confirm the critical directory.
const ah = path.join(target, 'src', 'main', 'agent-hooks')
console.log(`src/main/agent-hooks exists: ${fs.existsSync(ah)}`)
if (fs.existsSync(ah)) console.log(`  entries: ${fs.readdirSync(ah).length}`)

// Spot-check a file we know the restored tree imports.
const probe = path.join(ah, 'server.ts')
console.log(`  server.ts present: ${fs.existsSync(probe)}`)
if (fs.existsSync(probe)) {
  const h = crypto.createHash('sha256').update(fs.readFileSync(probe)).digest('hex').slice(0, 16)
  console.log(`  server.ts sha256[:16]: ${h}`)
}