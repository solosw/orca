import fs from 'node:fs'
import path from 'node:path'

const SID = 'S-1-5-21-3298863429-323757206-1539849354-1004'
const snap = `C:\\$Recycle.Bin\\${SID}\\$R249K1Q.warp-snapshots`
const manifest = JSON.parse(fs.readFileSync(path.join(snap, 'manifest.json'), 'utf8'))
const keys = Object.keys(manifest.files)

const out = []
const log = (s) => out.push(s)

log(`=== total keys: ${keys.length} ===`)
log('=== first 25 keys (learn the path format) ===')
for (const k of keys.slice(0, 25)) log('  ' + k)

log('')
log('=== keys matching custom-agent / customAgent ===')
log(keys.filter((k) => /custom.?agent/i.test(k)).slice(0, 40).map((k) => '  ' + k).join('\n') || '  (none)')

log('')
log('=== keys matching tui-agent ===')
log(keys.filter((k) => /tui-agent/i.test(k)).slice(0, 20).map((k) => '  ' + k).join('\n') || '  (none)')

log('')
log('=== keys matching file-snapshot ===')
log(keys.filter((k) => /file-snapshot/i.test(k)).slice(0, 20).map((k) => '  ' + k).join('\n') || '  (none)')

log('')
log('=== keys under src/shared (sample) ===')
log(keys.filter((k) => k.includes('src/shared')).slice(0, 20).map((k) => '  ' + k).join('\n') || '  (none)')

log('')
log('=== how many keys start with src/ ? ===')
log('  ' + keys.filter((k) => k.startsWith('src/')).length)

log('')
log('=== top-level prefixes (first path segment) ===')
const prefixes = new Map()
for (const k of keys) {
  const seg = k.split('/')[0]
  prefixes.set(seg, (prefixes.get(seg) ?? 0) + 1)
}
for (const [p, n] of [...prefixes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  log(`  ${p}: ${n}`)
}

log('')
log('=== second store: $R5OJCX8 ===')
const snap2 = `C:\\$Recycle.Bin\\${SID}\\$R5OJCX8.warp-snapshots`
const m2p = path.join(snap2, 'manifest.json')
if (fs.existsSync(m2p)) {
  try {
    const m2 = JSON.parse(fs.readFileSync(m2p, 'utf8'))
    log(`  manifest.files: ${Object.keys(m2.files ?? {}).length}`)
    const k2 = Object.keys(m2.files ?? {})
    log('  custom-agent matches: ' + k2.filter((k) => /custom.?agent/i.test(k)).length)
    log('  first 10: ' + k2.slice(0, 10).join(', '))
  } catch (e) {
    log('  ERR ' + e.message)
  }
} else {
  log('  no manifest')
}

fs.writeFileSync('.solcode/snap-keys.txt', out.join('\n'))
console.log(out.join('\n'))