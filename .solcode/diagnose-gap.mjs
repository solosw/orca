import fs from 'node:fs'
import path from 'node:path'

const target = 'C:\\software\\projects\\orca'
const store = 'C:\\software\\projects\\orca-recovery\\snapshot-store'
const donor = 'C:\\$Recycle.Bin\\S-1-5-21-3298863429-323757206-1539849354-1004\\$RXJIAKQ'
const SID = 'S-1-5-21-3298863429-323757206-1539849354-1004'
const bin = `C:\\$Recycle.Bin\\${SID}`

const out = []
const log = (s) => out.push(s)

log('=== 1) does src/main/agent-hooks exist in the RESTORED tree? ===')
const ah = path.join(target, 'src', 'main', 'agent-hooks')
log(`  exists: ${fs.existsSync(ah)}`)
if (fs.existsSync(ah)) log(`  entries: ${fs.readdirSync(ah).length}`)

log('')
log('=== 2) is it in the SNAPSHOT manifest? ===')
const manifest = JSON.parse(fs.readFileSync(path.join(store, 'manifest.json'), 'utf8'))
const keys = Object.keys(manifest.files)
const ahKeys = keys.filter((k) => k.startsWith('src\\main\\agent-hooks'))
log(`  manifest entries under src\\main\\agent-hooks: ${ahKeys.length}`)

log('')
log('=== 3) does the DONOR orca-main checkout have it? ===')
const donorAh = path.join(donor, 'src', 'main', 'agent-hooks')
log(`  exists: ${fs.existsSync(donorAh)}`)
if (fs.existsSync(donorAh)) log(`  entries: ${fs.readdirSync(donorAh).length}`)

log('')
log('=== 4) is agent-hooks gitignored in the restored .gitignore? ===')
const gi = path.join(target, '.gitignore')
if (fs.existsSync(gi)) {
  const lines = fs.readFileSync(gi, 'utf8').split('\n')
  const hits = lines.filter((l) => /agent-hook/i.test(l))
  log(`  .gitignore lines mentioning agent-hook: ${hits.length ? hits.join(' | ') : '(none)'}`)
}

log('')
log('=== 5) which src/main subdirs were captured vs missing? ===')
const srcMain = path.join(target, 'src', 'main')
const dirsOnDisk = fs.readdirSync(srcMain, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
log(`  subdirs on disk: ${dirsOnDisk.length}`)
const capturedDirs = new Set(
  keys.filter((k) => k.startsWith('src\\main\\')).map((k) => k.split('\\')[2])
)
log(`  subdirs captured in snapshot: ${capturedDirs.size}`)
const missing = dirsOnDisk.filter((d) => !capturedDirs.has(d))
log(`  on disk but NOT captured: ${missing.join(', ') || '(none)'}`)
const capturedNotOnDisk = [...capturedDirs].filter((d) => !dirsOnDisk.includes(d))
log(`  captured but NOT on disk: ${capturedNotOnDisk.join(', ') || '(none)'}`)

log('')
log('=== 6) other $R payloads: which contain src/main/agent-hooks? ===')
for (const e of fs.readdirSync(bin)) {
  if (!e.startsWith('$R')) continue
  const full = path.join(bin, e)
  let isDir = false
  try {
    isDir = fs.statSync(full).isDirectory()
  } catch {
    continue
  }
  if (!isDir) continue
  const candidate = path.join(full, 'src', 'main', 'agent-hooks')
  if (fs.existsSync(candidate)) {
    log(`  FOUND in ${e}: entries=${fs.readdirSync(candidate).length}`)
  }
}

fs.writeFileSync('.solcode/gap-diagnosis.txt', out.join('\n'))
console.log(out.join('\n'))