import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { configuredLocalMacOSSigning, resolveLocalMacOSSigning, signLocalMacOSApplication } from '../scripts/local-macos-signing.mjs'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); vi.resetAllMocks() })

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-local-signing-')); roots.push(directory)
  const record = join(directory, 'identity.json'), keychain = join(directory, 'signing.keychain-db')
  writeFileSync(keychain, 'fixture keychain')
  writeFileSync(record, JSON.stringify({ sha1: 'a'.repeat(40), password: 'not-exported' }))
  return { record, keychain }
}

it('reuses the existing personal identity across independent selections without exporting its password', () => {
  const { record, keychain } = fixture()
  const first = configuredLocalMacOSSigning({ PATH: '/fixture' }, record)
  expect(first).toEqual({ PATH: '/fixture', DSH_DESKTOP_LOCAL_SIGNING_IDENTITY: 'a'.repeat(40), DSH_DESKTOP_LOCAL_SIGNING_KEYCHAIN: keychain })
  expect(configuredLocalMacOSSigning({ PATH: '/fixture' }, record)).toEqual(first)
})

it('retains ad-hoc builds before setup and refuses damaged or incomplete selections', () => {
  const { record } = fixture()
  expect(configuredLocalMacOSSigning({}, record + '.missing')).toEqual({})
  expect(() => resolveLocalMacOSSigning({ DSH_DESKTOP_LOCAL_SIGNING_IDENTITY: 'a'.repeat(40) })).toThrow(/requires/)
  writeFileSync(record, 'broken')
  expect(() => configuredLocalMacOSSigning({}, record)).toThrow(/record is unreadable/)
  writeFileSync(record, JSON.stringify({ sha1: '-' }))
  expect(() => configuredLocalMacOSSigning({}, record)).toThrow(/requires/)
})

it('uses the selected certificate for the enclosing app without re-signing nested helpers', () => {
  const { record, keychain } = fixture(), environment = configuredLocalMacOSSigning({}, record)
  signLocalMacOSApplication('/fixture/Desktop.app', environment, '/fixture/entitlements.plist')
  expect(execFileSync).toHaveBeenNthCalledWith(1, '/usr/bin/codesign', ['--force', '--sign', 'a'.repeat(40), '--keychain', keychain,
    '--options', 'runtime', '--timestamp=none', '--entitlements', '/fixture/entitlements.plist', '/fixture/Desktop.app'])
  expect(execFileSync).toHaveBeenNthCalledWith(2, '/usr/bin/codesign', ['--verify', '--deep', '--strict', '/fixture/Desktop.app'])
  vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('keychain locked') })
  expect(() => { signLocalMacOSApplication('/fixture/Desktop.app', environment, '/fixture/entitlements.plist') }).toThrow('keychain locked')
})
