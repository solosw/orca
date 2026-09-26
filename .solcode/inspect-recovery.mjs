import fs from 'node:fs'
import path from 'node:path'

// The $R payload for the orca-main entry. Locate it by scanning $I metadata again,
// then inspect the payload tree (read-only).
const bin = 'C:\\$Recycle.Bin'

function parseDollarI(file) {
  const buf = fs.readFileSync(file)
  if (buf.length < 24 || buf.readBigUInt64LE(0) !== 2n) return null
  const size = buf.readBigUInt64LE(8)
  const mtime = buf.readBigUInt64LE(16)
  const nameLen = buf.readUInt32LE(24)
  const name = buf.subarray(28, 28 + nameLen * 2).toString('utf16le').replace(/\0+$/, '')
  return { size, mtime: new Date(Number(mtime) / 10000 - 11644473600000), name }
}

const candidates = []
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
      if (!parsed) continue
      if (/orca-main/i.test(parsed.name)) {
        const payload = path.join(dir, '$R' + entry.slice(2))
        candidates.push({ ...parsed, payload })
      }
    } catch {}
  }
}

console.log('=== orca-main recovery candidates ===')
for (const c of candidates) {
  console.log(`  original: ${c.name}`)
  console.log(`    deleted: ${c.mtime.toISOString()}`)
  console.log(`    stated size: ${c.size}`)
  console.log(`    payload path: ${c.payload}`)
  console.log(`    payload exists: ${fs.existsSync(c.payload)}`)
  if (fs.existsSync(c.payload)) {
    try {
      const st = fs.statSync(c.payload)
      if (st.isDirectory()) {
        const entries = fs.readdirSync(c.payload)
        console.log(`    payload is dir, entries=${entries.length}`)
        console.log(`    first entries: ${entries.slice(0, 15).join(', ')}`)
        // Does it look like the orca repo?
        for (const marker of ['package.json', 'electron.vite.config.ts', 'src', 'AGENTS.md', 'pnpm-lock.yaml']) {
          console.log(`      ${marker}: ${fs.existsSync(path.join(c.payload, marker))}`)
        }
      } else {
        console.log(`    payload is file, size=${st.size}`)
      }
    } catch (e) {
      console.log('    inspect ERR ' + e.code)
    }
  }
  console.log('')
}