/** Build local macOS Computer Use payloads and verify their selected application. */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { readCuaApplication } from '../../../scripts/cua-helper/payload.ts'
import { resolveDesktopTargetBuildPaths, resolveDesktopBuildTarget, desktopTargetPlatform } from './desktop-build-paths.mjs'

/**
 * Validate the selected helper's complete bytes, signature and target architecture.
 * @param directory - Architecture-specific native/bin directory on disk.
 * @param arch - Architecture the Desktop runtime will execute.
 * @returns The verified application directory.
 * @throws When the receipt, application bytes, signature or target architecture is invalid.
 */
export function verifyDesktopCuaHelper(directory: string, arch: string): string {
  const { application } = readCuaApplication(directory)
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', application])
  execFileSync('/usr/bin/lipo', ['-verify_arch', arch === 'x64' ? 'x86_64' : arch,
    join(application, 'Contents/MacOS/dsh-cua-native')])
  return application
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, '../../..')
  const target = desktopTargetPlatform(resolveDesktopBuildTarget())
  if (target.platform !== 'darwin') throw new Error('Local CUA preparation requires a macOS target')
  const provider = join(root, 'packages/experimental/cua-macos')
  if (existsSync(join(provider, 'cua-helper.json'))) throw new Error('Local CUA preparation cannot overwrite a staged distribution payload')
  const paths = resolveDesktopTargetBuildPaths()
  const output = join(paths.root, 'local-cua-helper')
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  execFileSync('/usr/bin/xcrun', ['python3', join(provider, 'native/build_app.py'),
    '--arch', target.arch === 'x64' ? 'x86_64' : target.arch,
    '--scratch-path', join(paths.root, 'cua-swift'), '--output-directory', output], { stdio: 'inherit' })
  verifyDesktopCuaHelper(output, target.arch)
  const destination = join(provider, 'native/bin', `darwin-${target.arch}`)
  rmSync(destination, { recursive: true, force: true })
  cpSync(output, destination, { recursive: true })
  verifyDesktopCuaHelper(destination, target.arch)
}
