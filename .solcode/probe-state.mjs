import fs from 'node:fs'

function probe(label, path) {
  console.log(`${label}: ${fs.existsSync(path) ? 'EXISTS' : 'missing'}`)
}

console.log('=== orca tree ===')
for (const p of [
  'package.json',
  'src',
  'node_modules',
  '.git',
  'pnpm-lock.yaml',
  'AGENTS.md',
  '.solcode/solcode.md'
]) {
  probe(`  ${p}`, p)
}

console.log('')
console.log('=== C:\\software\\projects\\rescue (is it an orca copy?) ===')
const rescuePkg = 'C:\\software\\projects\\rescue\\package.json'
if (fs.existsSync(rescuePkg)) {
  try {
    const pkg = JSON.parse(fs.readFileSync(rescuePkg, 'utf8'))
    console.log(`  name: ${pkg.name}`)
    console.log(`  version: ${pkg.version}`)
    console.log(`  scripts.build:win: ${pkg.scripts?.['build:win'] ?? '<none>'}`)
  } catch (error) {
    console.log(`  unreadable: ${error.message}`)
  }
} else {
  console.log('  no package.json')
}
for (const p of ['.git', 'src', 'node_modules']) {
  probe(`  ${p}`, `C:\\software\\projects\\rescue\\${p}`)
}

console.log('')
console.log('=== other candidate orca checkouts in C:\\software\\projects ===')
const root = 'C:\\software\\projects'
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const pkgPath = `${root}\\${entry.name}\\package.json`
  if (!fs.existsSync(pkgPath)) continue
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    if (pkg.name === 'orca') {
      console.log(`  ${entry.name}: name=orca version=${pkg.version}`)
    }
  } catch {
    /* ignore unreadable */
  }
}

console.log('')
console.log('=== C:\\software\\projects\\solcode ===')
for (const p of ['package.json', '.git', 'src']) {
  probe(`  ${p}`, `C:\\software\\projects\\solcode\\${p}`)
}