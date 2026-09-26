import fs from 'node:fs'
import path from 'node:path'

const payload = 'C:\\$Recycle.Bin\\S-1-5-21-3298863429-323757206-1539849354-1004\\$RXJIAKQ'

const out = []
const log = (s) => out.push(s)

log('=== recovery candidate: orca-main (Recycle Bin payload) ===')
log(`path: ${payload}`)
log(`exists: ${fs.existsSync(payload)}`)

if (fs.existsSync(payload)) {
  const entries = fs.readdirSync(payload, { withFileTypes: true })
  log(`top-level entries: ${entries.length}`)

  log('')
  log('=== completeness markers ===')
  for (const m of [
    'package.json', 'pnpm-lock.yaml', 'electron.vite.config.ts', 'AGENTS.md', 'goal.md',
    'src/shared/tui-agent.ts', 'src/shared/custom-agent-profiles.ts',
    'src/main/index.ts', 'node_modules', 'out', 'dist'
  ]) {
    log(`  ${m}: ${fs.existsSync(path.join(payload, m))}`)
  }

  log('')
  log('=== is its .git a real repository? ===')
  const g = path.join(payload, '.git')
  for (const m of ['HEAD', 'objects', 'refs', 'config']) {
    log(`  .git/${m}: ${fs.existsSync(path.join(g, m))}`)
  }
  try {
    log(`  .git/HEAD contents: ${fs.readFileSync(path.join(g, 'HEAD'), 'utf8').trim()}`)
  } catch (e) {
    log(`  .git/HEAD read: ERR ${e.code}`)
  }

  log('')
  log('=== does it contain this session\'s work? ===')
  for (const m of [
    'src/shared/file-snapshot-types.ts',
    'src/main/file-snapshots',
    'src/main/ipc/file-snapshots.ts',
    'src/shared/custom-agent-profiles.ts'
  ]) {
    log(`  ${m}: ${fs.existsSync(path.join(payload, m))}`)
  }

  log('')
  log('=== version in its package.json ===')
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(payload, 'package.json'), 'utf8'))
    log(`  name=${pkg.name} version=${pkg.version}`)
    log(`  has acp sdk dep: ${Boolean(pkg.dependencies?.['@agentclientprotocol/sdk'])}`)
  } catch (e) {
    log(`  ERR ${e.message}`)
  }
}

fs.writeFileSync('.solcode/candidate-check.txt', out.join('\n'))
console.log(out.join('\n'))