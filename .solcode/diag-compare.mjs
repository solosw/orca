import { createHash } from 'node:crypto'
import { readFileSync, statSync, existsSync } from 'node:fs'

const PKG =
  'node_modules/.pnpm/@vscode+windows-process-tre_7fa7a0322de208d70cad687cb70f1b07/node_modules/@vscode/windows-process-tree'
const SRC = `${PKG}/build/Release/windows_process_tree.node`
const DEST = `${PKG}/bin/win32-x64-148/windows-process-tree.node`

function hash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)
}

for (const [label, path] of [
  ['src ', SRC],
  ['dest', DEST]
]) {
  if (!existsSync(path)) {
    console.log(label, ': ABSENT')
    continue
  }
  const stat = statSync(path)
  console.log(label, `: size=${stat.size} hash=${hash(path)} nlink=${stat.nlink}`)
}

// Is the dest already the same bytes as src? If so, the copy that failed was
// redundant, and skipping it (rather than replacing a locked file) would let the
// build pass without closing Electron.
if (existsSync(SRC) && existsSync(DEST)) {
  console.log('identical bytes:', hash(SRC) === hash(DEST))
}