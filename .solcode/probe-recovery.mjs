import fs from 'node:fs'

function stat(label, p) {
  try {
    const s = fs.statSync(p)
    console.log(`${label}: ${s.isDirectory() ? '[dir]' : '[file]'} size=${s.size} mtime=${s.mtime.toISOString()}`)
  } catch (e) {
    console.log(`${label}: ERR ${e.code}`)
  }
}

console.log('=== timestamps of the stray .git files ===')
for (const f of ['diag.cjs', 'diag2.cjs', 'lsdir.cjs']) {
  stat(`  .git/${f}`, `.git/${f}`)
}

console.log('')
console.log('=== orca dir mtime ===')
stat('  orca', '.')
stat('  .git', '.git')
stat('  .solcode', '.solcode')

console.log('')
console.log('=== is rescue aimuxterm or orca? ===')
const rescue = 'C:\\software\\projects\\rescue'
for (const marker of ['wails.json', 'go.mod', 'app.go', 'pnpm-lock.yaml', 'AGENTS.md', 'src', 'internal']) {
  stat(`  rescue/${marker}`, `${rescue}\\${marker}`)
}
try {
  const pkg = fs.readFileSync(`${rescue}\\package.json`, 'utf8')
  console.log('  rescue/package.json first 200 chars:', JSON.stringify(pkg.slice(0, 200)))
} catch (e) {
  console.log('  rescue/package.json read ERR', e.code)
}

console.log('')
console.log('=== candidate lost-repo locations ===')
for (const p of [
  'C:\\software\\projects\\orca-base2',
  'C:\\software\\projects\\orca-baseline',
  'C:\\software\\projects\\orca.bak',
  'C:\\software\\projects\\orca_backup'
]) {
  console.log(`  ${p}: ${fs.existsSync(p) ? 'EXISTS' : 'missing'}`)
}

console.log('')
console.log('=== anything with an orca-shaped package.json under projects (depth 2) ===')
const root = 'C:\\software\\projects'
for (const e of fs.readdirSync(root, { withFileTypes: true })) {
  if (!e.isDirectory()) continue
  const pj = `${root}\\${e.name}\\package.json`
  if (!fs.existsSync(pj)) continue
  let name = '?'
  let hasElectronVite = fs.existsSync(`${root}\\${e.name}\\electron.vite.config.ts`)
  try {
    name = JSON.parse(fs.readFileSync(pj, 'utf8')).name ?? '(no name)'
  } catch {
    name = '(unparseable)'
  }
  console.log(`  ${e.name}: name=${name} electron.vite=${hasElectronVite}`)
}