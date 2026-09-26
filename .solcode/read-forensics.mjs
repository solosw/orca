import fs from 'node:fs'
import path from 'node:path'

const gitDir = '.git'
console.log('=== .git files (name, size, mtime) ===')
for (const e of fs.readdirSync(gitDir, { withFileTypes: true })) {
  const full = path.join(gitDir, e.name)
  if (e.isDirectory()) {
    console.log(`[d] ${e.name}`)
    continue
  }
  const s = fs.statSync(full)
  console.log(`[f] ${e.name}  size=${s.size}  mtime=${s.mtime.toISOString()}`)
}

// Read the summary artifacts, not the probe scripts.
for (const name of ['forensics.txt', 'recovery.txt', 'diag-report.txt']) {
  const p = path.join(gitDir, name)
  if (!fs.existsSync(p)) {
    console.log(`\n=== ${name}: missing ===`)
    continue
  }
  const text = fs.readFileSync(p, 'utf8')
  console.log(`\n=== ${name} (${text.length} chars) ===`)
  console.log(text.slice(0, 4000))
}