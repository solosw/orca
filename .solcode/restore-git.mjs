import fs from 'node:fs'
import path from 'node:path'

const target = 'C:\\software\\projects\\orca'
const donorGit = 'C:\\$Recycle.Bin\\S-1-5-21-3298863429-323757206-1539849354-1004\\$RXJIAKQ\\.git'
const preserve = 'C:\\software\\projects\\orca-recovery\\forensics-git'
const targetGit = path.join(target, '.git')

const out = []
const log = (s) => out.push(s)

log('=== donor .git state ===')
log(`exists: ${fs.existsSync(donorGit)}`)
for (const m of ['HEAD', 'objects', 'refs', 'index', 'config', 'packed-refs']) {
  const p = path.join(donorGit, m)
  log(`  ${m}: ${fs.existsSync(p)}`)
}

// Does it have a resolvable HEAD ref?
const headPath = path.join(donorGit, 'HEAD')
let headRef = null
if (fs.existsSync(headPath)) {
  headRef = fs.readFileSync(headPath, 'utf8').trim()
  log(`  HEAD -> ${headRef}`)
}
if (headRef?.startsWith('ref:')) {
  const refFile = path.join(donorGit, headRef.slice(4).trim())
  log(`  ${headRef.slice(4).trim()} exists: ${fs.existsSync(refFile)}`)
  if (fs.existsSync(refFile)) log(`    -> ${fs.readFileSync(refFile, 'utf8').trim()}`)
}
log(`  refs/heads entries: ${fs.existsSync(path.join(donorGit, 'refs', 'heads')) ? fs.readdirSync(path.join(donorGit, 'refs', 'heads')).join(', ') : 'none'}`)

// 1) Preserve the existing forensic-only .git
log('')
log('=== preserving forensic .git ===')
if (fs.existsSync(targetGit)) {
  fs.mkdirSync(preserve, { recursive: true })
  for (const e of fs.readdirSync(targetGit, { withFileTypes: true })) {
    const from = path.join(targetGit, e.name)
    const to = path.join(preserve, e.name)
    if (fs.existsSync(to)) continue
    try {
      fs.cpSync(from, to, { recursive: true })
    } catch (err) {
      log(`  skip ${e.name}: ${err.code}`)
    }
  }
  log(`  preserved ${fs.readdirSync(preserve).length} entries -> ${preserve}`)
  // Remove the forensic-only .git so the donor repo lands cleanly.
  fs.rmSync(targetGit, { recursive: true, force: true })
  log('  removed forensic-only .git')
}

// 2) Copy the donor repository in.
log('')
log('=== copying donor .git into place ===')
fs.cpSync(donorGit, targetGit, { recursive: true, force: true })
log(`  copied -> ${targetGit}`)
log(`  entries: ${fs.readdirSync(targetGit).length}`)

fs.writeFileSync('.solcode/git-restore.txt', out.join('\n'))
console.log(out.join('\n'))