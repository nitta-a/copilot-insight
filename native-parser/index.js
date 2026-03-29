'use strict'

const { existsSync } = require('fs')
const { join } = require('path')

const { platform, arch } = process

let nativeBinding = null
let loadError = null

function isMusl() {
  try {
    return require('fs').readFileSync('/usr/bin/ldd', 'utf8').includes('musl')
  } catch {
    return false
  }
}

switch (platform) {
  case 'linux':
    switch (arch) {
      case 'x64':
        if (existsSync(join(__dirname, 'native-parser.linux-x64-gnu.node'))) {
          try { nativeBinding = require('./native-parser.linux-x64-gnu.node') } catch (e) { loadError = e }
        } else if (existsSync(join(__dirname, 'native-parser.linux-x64-musl.node'))) {
          try { nativeBinding = require('./native-parser.linux-x64-musl.node') } catch (e) { loadError = e }
        }
        break
      case 'arm64':
        if (existsSync(join(__dirname, 'native-parser.linux-arm64-gnu.node'))) {
          try { nativeBinding = require('./native-parser.linux-arm64-gnu.node') } catch (e) { loadError = e }
        }
        break
    }
    break
  case 'darwin':
    switch (arch) {
      case 'x64':
        try { nativeBinding = require('./native-parser.darwin-x64.node') } catch (e) { loadError = e }
        break
      case 'arm64':
        try { nativeBinding = require('./native-parser.darwin-arm64.node') } catch (e) { loadError = e }
        break
    }
    break
  case 'win32':
    try { nativeBinding = require('./native-parser.win32-x64-msvc.node') } catch (e) { loadError = e }
    break
}

if (!nativeBinding) {
  if (loadError) { throw loadError }
  throw new Error(`Failed to load native-parser: unsupported platform ${platform}/${arch}`)
}

module.exports = nativeBinding