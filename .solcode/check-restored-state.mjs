import fs from 'node:fs'
import path from 'node:path'

const target = 'C:\\software\\projects\\orca'
const out = []
const log = (s) => out.push(s)

log('=== restored custom-agent-profiles.ts: old baseAgent design or ACP? ===')
const cap = path.join(target, 'src', 'shared', 'custom-agent-profiles.ts')
const text = fs.readFileSync(cap, 'utf8')
log(`  bytes: ${text.length}`)
log(`  mentions baseAgent: ${text.includes('baseAgent')}`)
log(`  mentions acp/ACP: ${/\bacp\b/i.test(text)}`)
log(`  mentions 'command': ${text.includes('command')}`)

log('')
log('=== is there ANY acp directory / file in the restored tree? ===')
function findAcp(dir, depth, acc) {
  if (depth > 6) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const full = path.join(dir, e.name)
    if (e.name === 'acp' || /^acp-/i.test(e.name)) acc.push(full)
    if (e.isDirectory()) findAcp(full, depth + 1, acc)
  }
}
const acpPaths = []
findAcp(path.join(target, 'src'), 0, acpPaths)
log('  ' + (acpPaths.join('\n  ') || '(none)'))

log('')
log('=== does package.json declare the ACP sdk? ===')
const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'))
log(`  @agentclientprotocol/sdk: ${pkg.dependencies?.['@agentclientprotocol/sdk'] ?? '<absent>'}`)
log(`  @zed-industries/agent-client-protocol: ${pkg.dependencies?.['@zed-industries/agent-client-protocol'] ?? '<absent>'}`)
log(`  total deps: ${Object.keys(pkg.dependencies ?? {}).length}`)

log('')
log('=== grep restored src for ACP protocol strings (bounded) ===')
const HITS = []
const NEEDLES = ['session/new', 'session/prompt', 'session/update', 'agent_message_chunk', 'request_permission', 'ClientSideConnection', 'ndJsonStream', 'fs/read_text_file']
function scan(dir, depth) {
  if (depth > 7 || HITS.length > 40) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      scan(full, depth + 1)
      continue
    }
    if (!/\.(ts|tsx|js|mjs|cjs|json)$/.test(e.name)) continue
    let body
    try {
      body = fs.readFileSync(full, 'utf8')
    } catch {
      continue
    }
    for (const n of NEEDLES) {
      if (body.includes(n)) {
        HITS.push(`${n}  <- ${path.relative(target, full)}`)
      }
    }
  }
}
scan(path.join(target, 'src'), 0)
log('  ' + (HITS.slice(0, 40).join('\n  ') || '(no ACP protocol strings)'))

log('')
log('=== my file-snapshot work survived? ===')
for (const p of [
  'src\\shared\\file-snapshot-types.ts',
  'src\\shared\\file-snapshot-channels.ts',
  'src\\main\\file-snapshots\\file-snapshot-engine.ts',
  'src\\main\\ipc\\file-snapshots.ts',
  'src\\preload\\api\\file-snapshots-bridge.ts',
  'src\\renderer\\src\\components\\right-sidebar\\FileSnapshotsPanel.tsx',
  'src\\renderer\\src\\components\\right-sidebar\\use-file-snapshots.ts'
]) {
  log(`  ${fs.existsSync(path.join(target, p)) ? 'YES' : 'no '} ${p}`)
}

fs.writeFileSync('.solcode/state-after-restore.txt', out.join('\n'))
console.log(out.join('\n'))