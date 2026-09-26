import fs from 'node:fs'
import path from 'node:path'

const SID = 'S-1-5-21-3298863429-323757206-1539849354-1004'
const RECOVERY = 'C:\\software\\projects\\orca-recovery'

const jobs = [
  {
    // The orca working-tree snapshot store — the ONLY copy of the lost uncommitted work.
    from: `C:\\$Recycle.Bin\\${SID}\\$R249K1Q.warp-snapshots`,
    to: path.join(RECOVERY, 'snapshot-store')
  },
  {
    // The 46MB real .git of the older orca-main checkout (git baseline).
    from: `C:\\$Recycle.Bin\\${SID}\\$R6T0RD3.git`,
    to: path.join(RECOVERY, 'orca-main.git')
  }
]

fs.mkdirSync(RECOVERY, { recursive: true })

for (const job of jobs) {
  if (!fs.existsSync(job.from)) {
    console.log(`MISSING source: ${job.from}`)
    continue
  }
  if (fs.existsSync(job.to)) {
    console.log(`already preserved: ${job.to}`)
    continue
  }
  console.log(`copying ${job.from}\n     -> ${job.to}`)
  fs.cpSync(job.from, job.to, { recursive: true, force: true })
  console.log('  done')
}

// Verify the preserved snapshot store.
const dest = path.join(RECOVERY, 'snapshot-store')
console.log('')
console.log('=== verify preserved snapshot store ===')
console.log(`exists: ${fs.existsSync(dest)}`)
const manifestPath = path.join(dest, 'manifest.json')
console.log(`manifest: ${fs.existsSync(manifestPath)}`)
if (fs.existsSync(manifestPath)) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  console.log(`manifest entries: ${Object.keys(m.files ?? {}).length}`)
  console.log(`capturedAt: ${m.capturedAt ?? '<none>'}`)
  const objectsDir = path.join(dest, 'objects')
  let count = 0
  for (const s of fs.readdirSync(objectsDir)) {
    count += fs.readdirSync(path.join(objectsDir, s)).length
  }
  console.log(`objects preserved: ${count}`)
}