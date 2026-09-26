import fs from 'node:fs'
import path from 'node:path'

function list(label, dir, depth = 2) {
  console.log(`=== ${label}: ${dir} ===`)
  if (!fs.existsSync(dir)) {
    console.log('  missing')
    return
  }
  const walk = (d, level) => {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch (e) {
      console.log('  ERR ' + e.code)
      return
    }
    for (const e of entries.slice(0, 40)) {
      const full = path.join(d, e.name)
      console.log('  '.repeat(level + 1) + (e.isDirectory() ? '[d] ' : '[f] ') + e.name)
      if (e.isDirectory() && level + 1 < depth) walk(full, level + 1)
    }
  }
  walk(dir, 0)
  console.log('')
}

// 1) Orca's own trash for removed worktrees — strongest lead.
list('orca worktree trash', 'C:\\Users\\solosw\\orca\\workspaces\\solcode\\.orca-worktree-trash')
list('orca workspaces root', 'C:\\Users\\solosw\\orca\\workspaces')

// 2) Recycle Bin: list every SID dir's contents.
console.log('=== Recycle Bin ===')
const bin = 'C:\\$Recycle.Bin'
for (const sid of fs.readdirSync(bin)) {
  const dir = path.join(bin, sid)
  let entries = []
  try {
    entries = fs.readdirSync(dir)
  } catch (e) {
    console.log(`  ${sid}: ERR ${e.code}`)
    continue
  }
  console.log(`  ${sid}: ${entries.length} entries`)
  for (const e of entries.slice(0, 25)) console.log(`      ${e}`)
}

// 3) Previous Versions / shadow copies need admin; just report.
console.log('')
console.log('=== orca dir final state ===')
for (const e of fs.readdirSync('C:\\software\\projects\\orca', { withFileTypes: true })) {
  console.log(`  ${e.isDirectory() ? '[d]' : '[f]'} ${e.name}`)
}