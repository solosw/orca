import fs from 'node:fs'
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
for (const name of [
  'build',
  'build:desktop',
  'build:native',
  'build:win',
  'build:unpack',
  'ensure:electron-runtime',
  'dev',
  'start'
]) {
  console.log(`${name}\n    ${pkg.scripts[name]}\n`)
}