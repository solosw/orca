import fs from 'node:fs'
import path from 'node:path'

const preservedGit = 'C:\\software\\projects\\orca-recovery\\orca-main.git'

const out = []
const log = (s) => out.push(s)

log('=== preserved orca-main.git ===')
log(`exists: ${fs.existsSync(preservedGit)}`)
if (fs.existsSync(preservedGit)) {
  const entries = fs.readdirSync(preservedGit)
  log(`entries: ${entries.join(', ')}`)
  log('')
  log('=== is it a usable git dir? ===')
  for (const m of ['HEAD', 'config', 'objects', 'refs', 'index']) {
    log(`  ${m}: ${fs.existsSync(path.join(preservedGit, m))}`)
  }
  const headPath = path.join(preservedGit, 'HEAD')
  if (fs.existsSync(headPath)) {
    log(`  HEAD: ${fs.readFileSync(headPath, 'utf8').trim()}`)
  }
  const cfgPath = path.join(preservedGit, 'config')
  if (fs.existsSync(cfgPath)) {
    log('  config:')
    for (const line of fs.readFileSync(cfgPath, 'utf8').split('\n').slice(0, 30)) {
      log(`    ${line}`)
    }
  }
  // How many loose objects?
  const objDir = path.join(preservedGit, 'objects')
  if (fs.existsSync(objDir)) {
    const shards = fs.readdirSync(objDir)
    let count = 0
    for (const s of shards) {
      if (s === 'pack' || s === 'info') {
        const sub = fs.readdirSync(path.join(objDir, s))
        log(`  objects/${s}: ${sub.length} files`)
        continue
      }
      try {
        count += fs.readdirSync(path.join(objDir, s)).length
      } catch {}
    }
    log(`  loose objects: ${count}`)
  }
}

log('')
log('=== current .git in orca (diagnostic-only) ===')
const cur = 'C:\\software\\projects\\orca\\.git'
log(`entries: ${fs.readdirSync(cur).join(', ')}`)

log('')
log('=== is there a packed-refs / any real git data anywhere? ===')
for (const p of [
  'C:\\software\\projects\\orca\\.git\\packed-refs',
  'C:\\software\\projects\\orca\\.git\\objects',
  'C:\\software\\projects\\orca-recovery\\orca-main.git\\packed-refs'
]) {
  log(`  ${p}: ${fs.existsSync(p)}`)
}

fs.writeFileSync('.solcode/git-check.txt', out.join('\n'))
console.log(out.join('\n'))