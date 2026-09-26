import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const out = []
const log = (s) => out.push(s)

function countObjects(objectsDir) {
  if (!fs.existsSync(objectsDir)) return { loose: 0, packs: 0, shards: 0 }
  let loose = 0
  let packs = 0
  let shards = 0
  for (const s of fs.readdirSync(objectsDir)) {
    const p = path.join(objectsDir, s)
    if (s === 'pack') {
      packs = fs.readdirSync(p).length
      continue
    }
    if (s === 'info') continue
    if (/^[0-9a-f]{2}$/.test(s)) {
      shards += 1
      loose += fs.readdirSync(p).length
    }
  }
  return { loose, packs, shards }
}

for (const [label, git] of [
  ['donor', 'C:\\$Recycle.Bin\\S-1-5-21-3298863429-323757206-1539849354-1004\\$RXJIAKQ\\.git'],
  ['preserved', 'C:\\software\\projects\\orca-recovery\\orca-main.git']
]) {
  log(`=== ${label} ===`)
  const c = countObjects(path.join(git, 'objects'))
  log(`  shards=${c.shards} loose=${c.loose} packs=${c.packs}`)
  log('')
}

// Is there ANY commit object in whichever repo has objects?
const candidates = [
  'C:\\software\\projects\\orca-recovery\\orca-main.git',
  'C:\\$Recycle.Bin\\S-1-5-21-3298863429-323757206-1539849354-1004\\$RXJIAKQ\\.git'
]
for (const git of candidates) {
  const objDir = path.join(git, 'objects')
  if (!fs.existsSync(objDir)) continue
  let commits = 0
  let scanned = 0
  for (const s of fs.readdirSync(objDir)) {
    if (!/^[0-9a-f]{2}$/.test(s)) continue
    for (const name of fs.readdirSync(path.join(objDir, s))) {
      scanned += 1
      if (scanned > 6000) break
      try {
        const buf = zlib.inflateSync(fs.readFileSync(path.join(objDir, s, name)))
        if (buf.subarray(0, buf.indexOf(0)).toString('utf8').startsWith('commit')) commits += 1
      } catch {}
    }
    if (scanned > 6000) break
  }
  log(`${git}: scanned=${scanned} commitObjects=${commits}`)
}

fs.writeFileSync('.solcode/object-count.txt', out.join('\n'))
console.log(out.join('\n'))