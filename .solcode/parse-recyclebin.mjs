import fs from 'node:fs'
import path from 'node:path'

const bin = 'C:\\$Recycle.Bin'
const results = []

// $I<id> files hold: header(8) + size(8) + deletion-time(8) + name-length(4) + UTF-16 path
function parseDollarI(file) {
  const buf = fs.readFileSync(file)
  if (buf.length < 24) return null
  const version = buf.readBigUInt64LE(0)
  if (version !== 2n) return null
  const size = buf.readBigUInt64LE(8)
  const mtime = buf.readBigUInt64LE(16)
  const nameLen = buf.readUInt32LE(24)
  const name = buf.subarray(28, 28 + nameLen * 2).toString('utf16le').replace(/\0+$/, '')
  return { size, mtime: new Date(Number(mtime) / 10000 - 11644473600000), name }
}

for (const sid of fs.readdirSync(bin)) {
  const dir = path.join(bin, sid)
  let entries
  try {
    entries = fs.readdirSync(dir)
  } catch {
    continue
  }
  for (const entry of entries) {
    if (!entry.startsWith('$I')) continue
    try {
      const parsed = parseDollarI(path.join(dir, entry))
      if (parsed && /orca/i.test(parsed.name)) {
        const payload = path.join(dir, '$R' + entry.slice(2))
        results.push({ ...parsed, sid, payloadExists: fs.existsSync(payload) })
      }
    } catch {}
  }
}

console.log('=== Recycle Bin entries whose original path mentions "orca" ===')
if (results.length === 0) {
  console.log('  (none)')
}
for (const r of results) {
  console.log(`  deleted=${r.mtime.toISOString()} size=${r.size}`)
  console.log(`    original path: ${r.name}`)
  console.log(`    payload present: ${r.payloadExists}`)
}

console.log('')
console.log('=== total $I entries scanned ===')
let total = 0
for (const sid of fs.readdirSync(bin)) {
  try {
    total += fs.readdirSync(path.join(bin, sid)).filter((e) => e.startsWith('$I')).length
  } catch {}
}
console.log(`  ${total}`)