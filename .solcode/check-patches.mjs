import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const target = 'C:\\software\\projects\\orca'
const store = 'C:\\software\\projects\\orca-recovery\\snapshot-store'

const out = []
const log = (s) => out.push(s)

log('=== restored config/patches ===')
const patches = path.join(target, 'config', 'patches')
log(`exists: ${fs.existsSync(patches)}`)
if (fs.existsSync(patches)) {
  const entries = fs.readdirSync(patches)
  log(`entries: ${entries.length}`)
  for (const e of entries.slice(0, 40)) log(`  ${e}`)
} else {
  log('  MISSING')
}

log('')
log('=== did the manifest capture config/patches at all? ===')
const manifest = JSON.parse(fs.readFileSync(path.join(store, 'manifest.json'), 'utf8'))
const keys = Object.keys(manifest.files)
const patchKeys = keys.filter((k) => /patch/i.test(k))
log(`  manifest entries matching "patch": ${patchKeys.length}`)
for (const k of patchKeys.slice(0, 40)) log(`    ${k}`)

log('')
log('=== what is under config\\ in the manifest? ===')
const cfgKeys = keys.filter((k) => k.startsWith('config\\'))
log(`  config entries: ${cfgKeys.length}`)
const cfgTop = new Map()
for (const k of cfgKeys) {
  const parts = k.split('\\')
  const seg = parts.length > 1 ? parts[1] : '(file)'
  cfgTop.set(seg, (cfgTop.get(seg) ?? 0) + 1)
}
for (const [k, n] of [...cfgTop.entries()].sort((a, b) => b[1] - a[1])) log(`  config/${k}: ${n}`)

log('')
log('=== count .patch files anywhere in the manifest ===')
log(`  ${keys.filter((k) => k.endsWith('.patch')).length}`)

log('')
log('=== so what did the snapshot NOT capture? compare vs expectation ===')
log('  node_modules in manifest: ' + keys.filter((k) => k.startsWith('node_modules')).length)
log('  .git in manifest: ' + keys.filter((k) => k.startsWith('.git')).length)
log('  .solcode in manifest: ' + keys.filter((k) => k.startsWith('.solcode')).length)

fs.writeFileSync('.solcode/patches-check.txt', out.join('\n'))
console.log(out.join('\n'))