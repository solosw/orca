import fs from 'node:fs'
import path from 'node:path'

const out = []
const log = (s) => out.push(s)

const SKIP = new Set([
  'node_modules', 'dist', 'out', 'build', 'AppData', 'Windows', '$Recycle.Bin',
  'Program Files', 'Program Files (x86)', 'ProgramData', 'System Volume Information',
  '.pnpm', 'pnpm', 'npm-cache'
])

// A REAL git dir has HEAD + objects + refs.
function isRealGitDir(dir) {
  try {
    return (
      fs.existsSync(path.join(dir, 'HEAD')) &&
      fs.existsSync(path.join(dir, 'objects')) &&
      fs.existsSync(path.join(dir, 'refs'))
    )
  } catch {
    return false
  }
}

const gitDirs = []
function walk(dir, depth) {
  if (depth > 4) return
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (SKIP.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.name === '.git' && isRealGitDir(full)) {
      let head = '?'
      try {
        head = fs.readFileSync(path.join(full, 'HEAD'), 'utf8').trim()
      } catch {}
      // How many loose objects + packed?
      let objCount = 0
      try {
        objCount = fs.readdirSync(path.join(full, 'objects')).length
      } catch {}
      gitDirs.push(`${full}  HEAD=${head}  objectsEntries=${objCount}`)
    }
    walk(full, depth + 1)
  }
}

for (const root of ['C:\\software', 'C:\\Users\\solosw']) {
  walk(root, 0)
}

log('=== real .git directories found ===')
log(gitDirs.length ? gitDirs.map((g) => '  ' + g).join('\n') : '  (none)')

log('')
log('=== C:\\software\\projects\\orca\\.git full contents ===')
const og = 'C:\\software\\projects\\orca\\.git'
if (fs.existsSync(og)) {
  const rec = (d, lvl) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      log('  '.repeat(lvl + 1) + (e.isDirectory() ? '[d] ' : '[f] ') + e.name)
      if (e.isDirectory() && lvl < 2) rec(full, lvl + 1)
    }
  }
  rec(og, 0)
} else {
  log('  missing')
}

log('')
log('=== is orca a junction/symlink? ===')
try {
  const st = fs.lstatSync('C:\\software\\projects\\orca')
  log(`  isSymbolicLink=${st.isSymbolicLink()} isDirectory=${st.isDirectory()}`)
  log(`  realpath=${fs.realpathSync('C:\\software\\projects\\orca')}`)
} catch (e) {
  log('  ERR ' + e.message)
}

fs.writeFileSync('.solcode/git-recovery.txt', out.join('\n'))
console.log(out.join('\n'))