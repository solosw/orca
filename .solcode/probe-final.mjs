import fs from 'node:fs'
import path from 'node:path'

const out = []
const log = (s) => out.push(s)

// 1) Did anything named like my feature survive anywhere?
log('=== search for my feature files (bounded) ===')
const SKIP = new Set(['node_modules', 'dist', 'out', 'build', 'AppData', 'Windows', '$Recycle.Bin', 'Program Files', 'Program Files (x86)', 'ProgramData', 'System Volume Information', '.pnpm'])
let hits = []
function walk(dir, depth, budget) {
  if (depth > 5 || budget.n > 200000) return
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    budget.n += 1
    if (SKIP.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isFile() && /file-snapshot|custom-agent-profiles|acp/i.test(e.name) && /\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) {
      hits.push(full)
    }
    if (e.isDirectory()) walk(full, depth + 1, budget)
  }
}
for (const root of ['C:\\software', 'C:\\Users\\solosw\\Desktop', 'C:\\Users\\solosw\\Documents', 'C:\\Users\\solosw\\Downloads']) {
  if (fs.existsSync(root)) walk(root, 0, { n: 0 })
}
log(hits.length ? hits.slice(0, 40).map((h) => '  ' + h).join('\n') : '  (none)')

// 2) Backup-ish locations
log('')
log('=== backup / sync locations ===')
for (const p of [
  'C:\\Users\\solosw\\OneDrive',
  'C:\\Users\\solosw\\OneDrive - ',
  'C:\\software\\projects\\solcode',
  'C:\\software\\projects\\orca\\..\\orca-base',
  'C:\\backup',
  'D:\\'
]) {
  log(`  ${p}: ${fs.existsSync(p) ? 'EXISTS' : 'missing'}`)
}

// 3) C:\software\projects\solcode (also has a .git)
log('')
log('=== C:\\software\\projects\\solcode ===')
try {
  const p = 'C:\\software\\projects\\solcode'
  const entries = fs.readdirSync(p, { withFileTypes: true })
  log(`  entries=${entries.length}`)
  for (const e of entries.slice(0, 30)) log(`    ${e.isDirectory() ? '[d]' : '[f]'} ${e.name}`)
  log(`  .git/HEAD exists: ${fs.existsSync(path.join(p, '.git', 'HEAD'))}`)
  log(`  .git/objects exists: ${fs.existsSync(path.join(p, '.git', 'objects'))}`)
} catch (e) {
  log('  ERR ' + e.message)
}

// 4) Is a matching git remote known anywhere (config)?
log('')
log('=== pnpm store: is the ACP sdk still cached? ===')
const store = 'C:\\Users\\solosw\\AppData\\Local\\pnpm\\store\\v11'
log(`  store exists: ${fs.existsSync(store)}`)

fs.writeFileSync('.solcode/final-recovery.txt', out.join('\n'))
console.log(out.join('\n'))