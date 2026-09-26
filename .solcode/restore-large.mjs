import fs from 'node:fs'
import path from 'node:path'

const donor = 'C:\\$Recycle.Bin\\S-1-5-21-3298863429-323757206-1539849354-1004\\$RXJIAKQ'
const target = 'C:\\software\\projects\\orca'

const files = [
  'config/patches/@xterm__xterm@6.1.0-beta.303.patch',
  'docs/assets/readme-feature-showcase.gif'
]

for (const rel of files) {
  const from = path.join(donor, rel.split('/').join(path.sep))
  const to = path.join(target, rel.split('/').join(path.sep))
  if (!fs.existsSync(from)) {
    console.log(`MISSING donor: ${rel}`)
    continue
  }
  const fromSize = fs.statSync(from).size
  if (fs.existsSync(to) && fs.statSync(to).size === fromSize) {
    console.log(`already present, same size: ${rel}`)
    continue
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  const toSize = fs.statSync(to).size
  console.log(`copied ${rel}  ${fromSize} -> ${toSize}  match=${fromSize === toSize}`)
}