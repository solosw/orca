import fs from 'node:fs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
console.log('in dependencies:', pkg.dependencies?.['@agentclientprotocol/sdk'] ?? '<absent>')

const sdkDir = 'node_modules/@agentclientprotocol/sdk'
console.log('sdk dir exists:', fs.existsSync(sdkDir))
if (fs.existsSync(sdkDir)) {
  console.log('sdk dir entries:', fs.readdirSync(sdkDir).join(', '))
  const dist = sdkDir + '/dist'
  console.log('dist exists:', fs.existsSync(dist))
  if (fs.existsSync(dist)) {
    const entries = fs.readdirSync(dist)
    console.log('dist entry count:', entries.length)
    console.log('has acp.d.ts:', entries.includes('acp.d.ts'))
    console.log('has acp.js:', entries.includes('acp.js'))
  }
  const pj = sdkDir + '/package.json'
  if (fs.existsSync(pj)) {
    const sp = JSON.parse(fs.readFileSync(pj, 'utf8'))
    console.log('sdk version:', sp.version)
  }
}

// Is the symlink target real?
try {
  const real = fs.realpathSync(sdkDir)
  console.log('sdk realpath:', real)
  console.log('realpath exists:', fs.existsSync(real))
} catch (error) {
  console.log('realpath failed:', error.message)
}

console.log('lockfile mentions sdk:', fs.readFileSync('pnpm-lock.yaml', 'utf8').includes('@agentclientprotocol/sdk'))