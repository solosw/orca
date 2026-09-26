import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SID = 'S-1-5-21-3298863429-323757206-1539849354-1004'
const snap = `C:\\$Recycle.Bin\\${SID}\\$R249K1Q.warp-snapshots`

const out = []
const log = (s) => out.push(s)

const manifest = JSON.parse(fs.readFileSync(path.join(snap, 'manifest.json'), 'utf8'))
const files = manifest.files
const keys = Object.keys(files)
log(`manifest entries: ${keys.length}`)

// 1) Layout of the object store
const objectsDir = path.join(snap, 'objects')
const shards = fs.readdirSync(objectsDir)
log(`objects/ shards: ${shards.length}`)
log(`  sample shards: ${shards.slice(0, 5).join(', ')}`)

// Count total objects on disk
let objectCount = 0
for (const s of shards) {
  try {
    objectCount += fs.readdirSync(path.join(objectsDir, s)).length
  } catch {}
}
log(`objects on disk: ${objectCount}`)

// 2) Can we resolve + decompress a known file?
function objectPath(hash) {
  return path.join(objectsDir, hash.slice(0, 2), hash.slice(2))
}

function readObject(hash) {
  const raw = fs.readFileSync(objectPath(hash))
  try {
    return zlib.gunzipSync(raw).toString('utf8')
  } catch {
    return raw.toString('utf8')
  }
}

log('')
log('=== key files: resolvable + decompressible? ===')
const probes = [
  'src\\shared\\custom-agent-profiles.ts',
  'src\\shared\\tui-agent.ts',
  'src\\renderer\\src\\components\\settings\\CustomAgentDialog.tsx',
  'src\\renderer\\src\\components\\settings\\CustomAgentsSetting.tsx',
  'src\\shared\\file-snapshot-types.ts',
  'src\\renderer\\src\\components\\right-sidebar\\FileSnapshotsPanel.tsx',
  'package.json',
  'goal.md',
  '.git\\HEAD'
]
for (const p of probes) {
  const hash = files[p]
  if (!hash) {
    log(`  NO-ENTRY  ${p}`)
    continue
  }
  try {
    const text = readObject(hash)
    log(`  OK(${text.length}b)  ${p}   [${text.slice(0, 40).replace(/\n/g, '\\n')}]`)
  } catch (e) {
    log(`  OBJ-MISS  ${p}  ${e.code ?? e.message}`)
  }
}

// 3) How many manifest entries have NO object on disk? (sample to stay fast)
log('')
log('=== object availability sample ===')
let checked = 0
let missing = 0
for (const k of keys) {
  if (checked >= 3000) break
  checked += 1
  const hash = files[k]
  if (!fs.existsSync(objectPath(hash))) missing += 1
}
log(`  sampled ${checked}, missing objects: ${missing}`)

log('')
log('=== was .git captured? ===')
log(`  manifest entries starting with ".git\\": ${keys.filter((k) => k.startsWith('.git\\')).length}`)
log(`  entries starting with ".git": ${keys.filter((k) => k.startsWith('.git')).length}`)

log('')
log('=== total manifest entries matching my feature files ===')
log(`  file-snapshot*: ${keys.filter((k) => /file-snapshot/i.test(k)).length}`)
log(`  FileSnapshotsPanel: ${keys.filter((k) => /FileSnapshotsPanel/i.test(k)).length}`)
log(`  custom-agent: ${keys.filter((k) => /custom-agent/i.test(k)).length}`)

fs.writeFileSync('.solcode/snap-usable.txt', out.join('\n'))
console.log(out.join('\n'))