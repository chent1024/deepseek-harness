/** Reuse a user-owned certificate for local Desktop and Computer Use builds. */
import { existsSync, readFileSync, lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { execFileSync } from 'node:child_process'

const IDENTITY = 'DSH_DESKTOP_LOCAL_SIGNING_IDENTITY'
const KEYCHAIN = 'DSH_DESKTOP_LOCAL_SIGNING_KEYCHAIN'

/**
 * Validate an explicit local selection without discovering or changing identities.
 * @param {NodeJS.ProcessEnv} environment Packaging environment.
 * @returns {{ identity: string, keychain: string } | undefined} Selected certificate, or ad-hoc mode.
 */
export function resolveLocalMacOSSigning(environment = process.env) {
  const identity = environment[IDENTITY]
  const keychain = environment[KEYCHAIN]
  if (identity === undefined && keychain === undefined) return undefined
  if (typeof identity !== 'string' || !/^[a-f\d]{40}$/iu.test(identity) || typeof keychain !== 'string' || !isAbsolute(keychain)) {
    throw new Error('Local macOS signing requires a certificate SHA-1 fingerprint and an absolute keychain path')
  }
  const stat = lstatSync(keychain)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Local macOS signing keychain must be a regular file')
  return { identity, keychain }
}

/**
 * Select the existing personal identity; missing setup retains ad-hoc local builds.
 * @param {NodeJS.ProcessEnv} environment Explicit selections take precedence over the local record.
 * @param {string} record Private identity record created by the native setup script.
 * @returns {NodeJS.ProcessEnv} Environment containing only the public signing selection.
 */
export function configuredLocalMacOSSigning(environment = process.env,
  record = join(homedir(), '.cua-macos-keys/dev/identity.json')) {
  if (environment[IDENTITY] !== undefined || environment[KEYCHAIN] !== undefined) {
    resolveLocalMacOSSigning(environment)
    return { ...environment }
  }
  if (!existsSync(record)) return { ...environment }
  let fingerprint
  try { fingerprint = JSON.parse(readFileSync(record, 'utf8')).sha1 }
  catch { throw new Error('Local macOS signing record is unreadable; reuse or repair the existing signing identity') }
  const selected = { ...environment, [IDENTITY]: fingerprint, [KEYCHAIN]: join(dirname(record), 'signing.keychain-db') }
  resolveLocalMacOSSigning(selected)
  return selected
}

/**
 * Sign only the enclosing app; nested runtime and helper signatures remain intact.
 * @param {string} application Built application bundle.
 * @param {NodeJS.ProcessEnv} environment Local certificate selection.
 * @param {string} entitlements Existing Desktop entitlement file.
 */
export function signLocalMacOSApplication(application, environment, entitlements) {
  const selection = resolveLocalMacOSSigning(environment)
  if (selection === undefined) return
  execFileSync('/usr/bin/codesign', ['--force', '--sign', selection.identity, '--keychain', selection.keychain,
    '--options', 'runtime', '--timestamp=none', '--entitlements', entitlements, application])
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', application])
}
