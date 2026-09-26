import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const store = 'C:\\software\\projects\\orca-recovery\\snapshot-store'
const manifest = JSON.parse(fs.readFileSync(path.join(store, 'manifest.json'), 'utf8'))
const files = manifest.files
const keys = Object.keys(files)

const out = []
const log = (s) => out.push(s)

log(`manifest entries: ${keys.length}`)

// What top-level trees are covered?
const top = new Map()
for (const k of keys) {
  const seg = k.includes('\\') ? k.slice(0, k.indexOf('\\')) : '(root file)'
  top.set(seg, (top.get(seg) ?? 0) + 1)
}
log('')
log('=== top-level trees covered ===')
for (const [k, n] of [...top.entries()].sort((a, b) => b[1] - a[1])) {
  log(`  ${k}: ${n}`)
}

// Is node_modules present?
log('')
log(`node_modules entries: ${keys.filter((k) => k.startsWith('node_modules')).length}`)
log(`src entries: ${keys.filter((k) => k.startsWith('src')).length}`)
log(`config entries: ${keys.filter((k) => k.startsWith('config')).length}`)

// Critical marker files for continuing the goal.
log('')
log('=== goal-critical files present? ===')
for (const p of [
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'electron.vite.config.ts',
  'config\\vitest.config.ts',
  'config\\tsconfig.node.json',
  'config\\tsconfig.tc.web.json',
  'AGENTS.md',
  'CLAUDE.md',
  'src\\shared\\custom-agent-profiles.ts',
  'src\\shared\\agent-startup-plan-inputs.ts',
  'src\\shared\\file-snapshot-types.ts',
  'src\\main\\file-snapshots\\file-snapshot-engine.ts',
  'src\\main\\ipc\\file-snapshots.ts',
  'src\\renderer\\src\\components\\right-sidebar\\FileSnapshotsPanel.tsx',
  'src\\renderer\\src\\i18n\\locales\\en.json',
  'goal.md'
]) {
  log(`  ${Object.hasOwn(files, p) ? 'YES' : 'no '} ${p}`)
}

// Sanity: can we read package.json and see the ACP dep + scripts?
log('')
log('=== package.json from the snapshot ===')
try {
  const text = zlib.gunzipSync(fs.readFileSync(
    path.join(store, 'objects', files['package.json'].slice(0, 2), files['package.json'].slice(2))
  )).toString('utf8')
  const pkg = JSON.parse(text)
  log(`  name=${pkg.name} version=${pkg.version}`)
  log(`  acp sdk dep: ${pkg.dependencies?.['@agentclientprotocol/sdk'] ?? '<absent>'}`)
  log(`  scripts.build:desktop: ${pkg.scripts?.['build:desktop'] ? 'present' : 'absent'}`)
  log(`  has fileSnapshots scripts: ${Boolean(pkg.scripts?.['build:win'])}`)
} catch (e) {
  log('  ERR ' + e.message)
}

fs.writeFileSync('.solcode/restore-plan.txt', out.join('\n'))
console.log(out.join('\n'))