import fs from 'node:fs'
import path from 'node:path'

const out = []
const log = (s) => out.push(s)

function walk(dir, label, maxDepth) {
  log(`=== ${label} ===`)
  log(`path: ${dir}`)
  if (!fs.existsSync(dir)) {
    log('  MISSING')
    log('')
    return
  }
  const rec = (d, level) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch (e) {
      log('  '.repeat(level + 1) + 'ERR ' + e.code)
      return
    }
    log('  '.repeat(level + 1) + `entryCount=${entries.length}`)
    for (const e of entries.slice(0, 60)) {
      const full = path.join(d, e.name)
      let extra = ''
      if (e.isFile()) {
        try {
          extra = ` size=${fs.statSync(full).size}`
        } catch {}
      }
      log('  '.repeat(level + 1) + (e.isDirectory() ? '[d] ' : '[f] ') + e.name + extra)
      if (e.isDirectory() && level + 1 < maxDepth) rec(full, level + 1)
    }
  }
  rec(dir, 0)
  log('')
}

walk('C:\\Users\\solosw\\orca\\workspaces\\solcode\\.orca-worktree-trash', 'orca worktree trash (solcode)', 3)
walk('C:\\Users\\solosw\\orca\\workspaces\\solcode', 'orca workspace solcode', 2)
walk('C:\\Users\\solosw\\orca\\workspaces\\.orca-worktree-trash', 'orca worktree trash (root)', 3)
walk('C:\\Users\\solosw\\orca\\workspaces\\.orca-preparing', 'orca preparing', 2)

log('=== Recycle Bin, all SIDs ===')
const bin = 'C:\\$Recycle.Bin'
for (const sid of fs.readdirSync(bin)) {
  const dir = path.join(bin, sid)
  try {
    const entries = fs.readdirSync(dir)
    log(`  ${sid}: ${entries.length} entries`)
    for (const e of entries.slice(0, 30)) {
      const full = path.join(dir, e)
      let isDir = false
      try {
        isDir = fs.statSync(full).isDirectory()
      } catch {}
      log(`      ${isDir ? '[d]' : '[f]'} ${e}`)
    }
  } catch (e) {
    log(`  ${sid}: ERR ${e.code}`)
  }
}

fs.writeFileSync('.solcode/recovery-report.txt', out.join('\n'))
console.log('written .solcode/recovery-report.txt')
console.log(out.join('\n'))