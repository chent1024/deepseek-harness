/** Selected helper bytes must survive native preparation and Desktop packaging. */
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, renameSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { cuaApplicationDigest } from '../../../scripts/cua-helper/payload.ts'
import { verifyDesktopCuaHelper } from '../scripts/prepare-local-cua-helper.ts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.resetAllMocks() })

function fixture(): { directory: string; executable: string } {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-cua-'))
  roots.push(directory)
  const temporary = join(directory, 'staging', 'DSH Computer Use.app')
  for (const path of ['Contents/Info.plist', 'Contents/MacOS/dsh-cua-native', 'Contents/Resources/DSHComputerUse.icns', 'Contents/_CodeSignature/CodeResources']) {
    mkdirSync(join(temporary, path, '..'), { recursive: true })
    writeFileSync(join(temporary, path), path)
  }
  chmodSync(join(temporary, 'Contents/MacOS/dsh-cua-native'), 0o755)
  const digest = cuaApplicationDigest(temporary)
  const application = join(directory, digest, 'DSH Computer Use.app')
  renameSync(join(directory, 'staging'), join(directory, digest))
  writeFileSync(join(directory, 'current.json'), JSON.stringify({ bundle: digest }))
  return { directory, executable: join(application, 'Contents/MacOS/dsh-cua-native') }
}

it('refuses an absent receipt before invoking signing tools', () => {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-cua-missing-')); roots.push(directory)
  expect(() => verifyDesktopCuaHelper(directory, 'arm64')).toThrow()
  expect(execFileSync).not.toHaveBeenCalled()
})

it('verifies the selected application signature and target architecture', () => {
  const { directory, executable } = fixture()
  verifyDesktopCuaHelper(directory, 'arm64')
  expect(execFileSync).toHaveBeenCalledWith('/usr/bin/lipo', ['-verify_arch', 'arm64', executable])
  expect(execFileSync).toHaveBeenCalledWith('/usr/bin/codesign', ['--verify', '--deep', '--strict', join(executable, '../../..')])
})

it('rejects helper bytes altered after selection', () => {
  const { directory, executable } = fixture(); writeFileSync(executable, 'changed')
  expect(() => verifyDesktopCuaHelper(directory, 'arm64')).toThrow(/digest/)
  expect(execFileSync).not.toHaveBeenCalled()
})

it('rejects a receipt whose executable is missing', () => {
  const { directory, executable } = fixture(); rmSync(executable)
  expect(() => verifyDesktopCuaHelper(directory, 'arm64')).toThrow()
  expect(execFileSync).not.toHaveBeenCalled()
})

it('propagates a rejected native signature', () => {
  const { directory } = fixture()
  vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('signature rejected') })
  expect(() => verifyDesktopCuaHelper(directory, 'arm64')).toThrow('signature rejected')
})
