import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SID = 'S-1-5-21-3298863429-323757206-1539849354-1004'
const bin = `C:\\$Recycle.Bin\\${SID}`
const store = 'C:\\software\\projects\\orca-recovery\\snapshot-store'
const MISSING = '@xterm__xterm@6.1.0-beta.303.patch'

const out = []
const log = (s) => out.push(s)

log(`=== looking for: ${MISSING} ===`)

// (a) The full orca-main checkout payload.
const mainCheckout = path.join(bin, '$RXJIAKQ')
log('')
log(`--- orca-main payload: ${mainCheckout} ---`)
log(`  exists: ${fs.existsSync(mainCheckout)}`)
const mainPatches = path.join(mainCheckout, 'config', 'patches')
log(`  config/patches exists: ${fs.existsSync(mainPatches)}`)
if (fs.existsSync(mainPatches)) {
  for (const e of fs.readdirSync(mainPatches)) {
    const full = path.join(mainPatches, e)
    const st = fs.statSync(full)
    log(`    ${st.isDirectory() ? '[d]' : '[f]'} ${e}${st.isFile() ? `  size=${st.size}` : ''}`)
  }
}

// (b) Size of the captured .src.patch, to estimate why .patch was skipped.
log('')
log('--- captured xterm .src.patch sizes in the snapshot store ---')
const manifest = JSON.parse(fs.readFileSync(path.join(store, 'manifest.json'), 'utf8'))
const objPath = (h) => path.join(store, 'objects', h.slice(0, 2), h.slice(2))
for (const [k, h] of Object.entries(manifest.files)) {
  if (!/config\\patches\\xterm-src/.test(k)) continue
  try {
    const raw = fs.readFileSync(objPath(h))
    let size
    try {
      size = zlib.gunzipSync(raw).length
    } catch {
      size = raw.length
    }
    log(`  ${k}  uncompressed=${size}`)
  } catch (e) {
    log(`  ${k}  ERR ${e.code}`)
  }
}

// (c) Any orca-shaped tree on disk that HAS the patch?
log('')
log('--- scan all $R payloads for the patch ---')
for (const entry of fs.readdirSync(bin)) {
  if (!entry.startsWith('$R')) continue
  const full = path.join(bin, entry)
  let isDir = false
  try {
    isDir = fs.statSync(full).isDirectory()
  } catch {
    continue
  }
  if (!isDir) continue
  const candidate = path.join(full, 'config', 'patches', MISSING)
  if (fs.existsSync(candidate)) {
    log(`  FOUND in ${entry}: ${candidate} (size=${fs.statSync(candidate).size})`)
  }
}

// (d) Does the repo have a script to regenerate it?
log('')
log('--- regeneration script present? ---')
for (const p of [
  'C:\\software\\projects\\orca\\config\\scripts\\regenerate-xterm-patches.mjs',
  'C:\\software\\projects\\orca\\config\\scripts\\xterm-patch-text.mjs',
  'C:\\software\\projects\\orca\\config\\patches\\xterm-upstream.json'
]) {
  log(`  ${fs.existsSync(p) ? 'YES' : 'no '} ${p}`)
}

fs.writeFileSync('.solcode/find-patch.txt', out.join('\n'))
console.log(out.join('\n'))