import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const store = 'C:\\software\\projects\\orca-recovery\\snapshot-store'
const target = 'C:\\software\\projects\\orca'

const manifest = JSON.parse(fs.readFileSync(path.join(store, 'manifest.json'), 'utf8'))
const files = manifest.files
const keys = Object.keys(files)

const objectsDir = path.join(store, 'objects')
const objectPath = (hash) => path.join(objectsDir, hash.slice(0, 2), hash.slice(2))

function readObject(hash) {
  const raw = fs.readFileSync(objectPath(hash))
  try {
    return zlib.gunzipSync(raw)
  } catch {
    // Store falls back to raw bytes when a payload was not gzipped.
    return raw
  }
}

let written = 0
let skipped = 0
const failures = []

for (const key of keys) {
  // Manifest keys are Windows-style (backslash-separated, repo-relative).
  const relative = key.split('\\').join(path.sep)
  const dest = path.join(target, relative)
  // Never write outside the target (defensive; keys are repo-relative).
  if (!path.resolve(dest).startsWith(path.resolve(target) + path.sep)) {
    failures.push(`${key}: escapes target`)
    continue
  }
  try {
    const content = readObject(files[key])
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, content)
    written += 1
  } catch (e) {
    failures.push(`${key}: ${e.code ?? e.message}`)
  }
}

console.log(`restored: ${written}`)
console.log(`failed:   ${failures.length}`)
if (failures.length) console.log(failures.slice(0, 25).join('\n'))

// Spot-check the critical paths landed.
console.log('')
console.log('=== spot checks ===')
for (const p of [
  'package.json',
  'pnpm-lock.yaml',
  'AGENTS.md',
  'electron.vite.config.ts',
  'src\\shared\\custom-agent-profiles.ts',
  'src\\shared\\file-snapshot-types.ts',
  'src\\main\\file-snapshots\\file-snapshot-engine.ts',
  'src\\renderer\\src\\components\\right-sidebar\\FileSnapshotsPanel.tsx'
]) {
  console.log(`  ${fs.existsSync(path.join(target, p)) ? 'OK ' : 'MISSING'} ${p}`)
}