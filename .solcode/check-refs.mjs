import fs from 'node:fs'
import path from 'node:path'

const git = 'C:\\software\\projects\\orca-recovery\\orca-main.git'

function tree(dir, depth = 0, max = 3, out = []) {
  if (depth > max) return out
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    out.push('  '.repeat(depth) + (e.isDirectory() ? '[d] ' : '[f] ') + e.name)
    if (e.isDirectory() && depth < max) tree(path.join(dir, e.name), depth + 1, max, out)
  }
  return out
}

console.log('=== refs tree ===')
console.log(tree(path.join(git, 'refs'), 0, 4).join('\n') || '  (empty)')

const masterRef = path.join(git, 'refs', 'heads', 'master')
console.log('')
console.log(`refs/heads/master exists: ${fs.existsSync(masterRef)}`)
if (fs.existsSync(masterRef)) {
  console.log(`  -> ${fs.readFileSync(masterRef, 'utf8').trim()}`)
}

console.log('')
console.log('=== objects: shard sample ===')
const objDir = path.join(git, 'objects')
const shards = fs.readdirSync(objDir).filter((s) => /^[0-9a-f]{2}$/.test(s)).sort()
console.log(`  real shards: ${shards.length}`)
for (const s of shards.slice(0, 3)) {
  const entries = fs.readdirSync(path.join(objDir, s))
  console.log(`    ${s}: ${entries.length} objects, e.g. ${entries[0]}`)
}

// Can we read a commit object? Try to find one (type 1 = commit in git loose format).
import zlib from 'node:zlib'
function looseType(hash) {
  try {
    const buf = zlib.inflateSync(fs.readFileSync(path.join(objDir, hash.slice(0, 2), hash.slice(2))))
    return buf.subarray(0, buf.indexOf(0)).toString('utf8')
  } catch {
    return null
  }
}

console.log('')
console.log('=== scanning for a commit object (bounded) ===')
let foundCommit = null
let scanned = 0
outer: for (const s of shards) {
  for (const name of fs.readdirSync(path.join(objDir, s))) {
    scanned += 1
    const t = looseType(s + name)
    if (t && t.startsWith('commit')) {
      foundCommit = s + name
      break outer
    }
    if (scanned > 2000) break outer
  }
}
console.log(`  scanned=${scanned} foundCommit=${foundCommit ?? 'none'}`)