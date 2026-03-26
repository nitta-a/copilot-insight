'use strict'

const { existsSync, readFileSync } = require('fs')
const join = require('path').join
const { platform, arch } = process

let nativeBinding = null
let loadError = null

function isMusl() {
  if (!existsSync('/usr/bin/ldd')) return true
  try {
    return readFileSync('/usr/bin/ldd', 'utf8').includes('musl')
  } catch {
    return false
  }
}

function tryRequire(name) {
  const filePath = join(__dirname, name)
  if (!existsSync(filePath)) {
    return null
  }
  try {
    return require(filePath)
  } catch (e) {
    loadError = e
    return null
  }
}

switch (platform) {
  case 'win32':
    if (arch === 'x64') nativeBinding = tryRequire('native-parser.win32-x64-msvc.node')
    break
  case 'darwin':
    if (arch === 'x64') nativeBinding = tryRequire('native-parser.darwin-x64.node')
    else if (arch === 'arm64') nativeBinding = tryRequire('native-parser.darwin-arm64.node')
    break
  case 'linux':
    if (arch === 'x64') {
      nativeBinding = isMusl()
        ? tryRequire('native-parser.linux-x64-musl.node')
        : tryRequire('native-parser.linux-x64-gnu.node')
    } else if (arch === 'arm64') {
      nativeBinding = isMusl()
        ? tryRequire('native-parser.linux-arm64-musl.node')
        : tryRequire('native-parser.linux-arm64-gnu.node')
    }
    break
}

if (!nativeBinding) {
  throw loadError || new Error(`Native parser not available for ${platform}-${arch}`)
}

module.exports = nativeBinding