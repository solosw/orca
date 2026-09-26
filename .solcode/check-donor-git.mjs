import fs from 'node:fs'
import path from 'node:path'

const donorGit = 'C:\\$Recycle.Bin\\S-1-5-21-3298863429-323757206-1539849354-1004\\$RXJIAKQ\\.git'
const recovered = 'C:\\software\\projects\\orca-recovery\\orca-main.git'
const out = []
const log = (s) => out.push(s)

for (const [label, git] of [['donor (Recycle Bin)', donorGit], ['preserved copy', recovered]]) {
  log(`=== ${label}: ${git} ===`)
  log(`exists: ${fs.existsSync(git)}`)
  if (!fs.existsSync(git)) { log(''); continue }
  log(`entries: ${fs.readdirSync(git).join(', ')}`)

  const headPath = path.join(git, 'HEAD')
  if (fs.existsSync(headPath)) {
    const head = fs.readFileSync(headPath, 'utf8').trim()
    log(`HEAD: ${head}`)
    if (head.startsWith('ref:')) {
      const ref = head.slice(4).trim()
      const refFile = path.join(git, ref)
      log(`  ${ref} exists: ${fs.existsSync(refFile)}`)
      if (fs.existsSync(refFile)) log(`    -> ${fs.readFileSync(refFile, 'utf8').trim()}`)
      const packed = path.join(git, 'packed-refs')
      if (fs.existsSync(packed)) {
        const lines = fs.readFileSync(packed, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'))
        log(`  packed-refs lines: ${lines.length}`)
        for (const l of lines.slice(0, 5)) log(`    ${l}`)
      } else {
        log('  no packed-refs')
      }
    }
  }

  const refsHeads = path.join(git, 'refs', 'heads')
  log(`refs/heads: ${fs.existsSync(refsHeads) ? fs.readdirSync(refsHeads).join(', ') || '(empty)' : 'missing'}`)
  const refsRemotes = path.join(git, 'refs', 'remotes')
  log(`refs/remotes: ${fs.existsSync(refsRemotes) ? fs.readdirSync(refsRemotes).join(', ') || '(empty)' : 'missing'}`)
  log('')
}

log('=== how many loose objects + packs in donor ===')
const objDir = path.join(donorGit, 'objects')
if (fs.existsSync(objDir)) {
  let loose = 0
  for (const s of fs.readdirSync(objDir)) {
    const p = path.join(objDir, s)
    if (s === 'pack' || s === 'info') {
      log(`  ${s}/: ${fs.readdirSync(p).length} files`)
    } else if (/^[0-9a-f]{2}$/.test(s)) {
      loose += fs.readdirSync(p).length
    }
  }
  log(`  loose objects: ${loose}`)
}

fs.writeFileSync('.solcode/donor-git-state.txt', out.join('\n'))
console.log(out.join('\n'))