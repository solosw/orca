import fs from 'node:fs'
import path from 'node:path'

const SID = 'S-1-5-21-3298863429-323757206-1539849354-1004'
const bin = `C:\\$Recycle.Bin\\${SID}`

const out = []
const log = (s) => out.push(s)

log('=== recycle bin $R payloads mentioning warp-snapshots or orca ===')
for (const entry of fs.readdirSync(bin)) {
  if (!entry.startsWith('$R')) continue
  if (!/warp-snapshots|orca/i.test(entry)) continue
  const full = path.join(bin, entry)
  let kind = '?'
  let size = 0
  let count = 0
  try {
    const st = fs.statSync(full)
    kind = st.isDirectory() ? 'dir' : 'file'
    size = st.size
    if (st.isDirectory()) count = fs.readdirSync(full).length
  } catch (e) {
    kind = 'ERR ' + e.code
  }
  log(`  ${entry}  kind=${kind} size=${size} entries=${count}`)
}

const snap = path.join(bin, '$R249K1Q.warp-snapshots')
log('')
log(`=== snapshot store candidate ===`)
log(`  path: ${snap}`)
log(`  exists: ${fs.existsSync(snap)}`)

if (fs.existsSync(snap)) {
  const top = fs.readdirSync(snap, { withFileTypes: true })
  log(`  top-level: ${top.map((e) => (e.isDirectory() ? '[d]' : '[f]') + e.name).join(', ')}`)

  const manifestPath = path.join(snap, 'manifest.json')
  log(`  manifest.json exists: ${fs.existsSync(manifestPath)}`)
  if (fs.existsSync(manifestPath)) {
    const raw = fs.readFileSync(manifestPath, 'utf8')
    log(`  manifest bytes: ${raw.length}`)
    try {
      const m = JSON.parse(raw)
      const keys = Object.keys(m.files ?? {})
      log(`  manifest.files entries: ${keys.length}`)
      const wanted = [
        'src/shared/custom-agent-profiles.ts',
        'src/shared/agent-startup-plan-inputs.ts',
        'src/renderer/src/components/settings/CustomAgentDialog.tsx',
        'src/renderer/src/components/settings/CustomAgentsSetting.tsx',
        'src/shared/tui-agent.ts',
        'package.json',
        'goal.md'
      ]
      log('  === presence of key paths ===')
      for (const w of wanted) {
        const hit = Object.hasOwn(m.files ?? {}, w)
        log(`    ${hit ? 'YES' : 'no '} ${w}`)
      }
    } catch (e) {
      log('  manifest parse ERR ' + e.message)
    }
  }
}

fs.writeFileSync('.solcode/snap-verify.txt', out.join('\n'))
console.log(out.join('\n'))