/** Build and install the local unsigned macOS application with rollback. */

import { execFile, spawn } from 'node:child_process'
import { access, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const execute = promisify(execFile)
const LOCAL_APP_ID = 'com.deepseek.harness.local'
const LOCAL_APP_NAME = 'DeepSeek.app'
const LEGACY_LOCAL_APP_NAME = 'DeepSeek Harness Local.app'

/** Identifying values read from one macOS application bundle. */
export interface LocalMacApplicationMetadata {
  readonly bundleId: string
  readonly version: string
}

/** One local application replacement request. */
export interface LocalMacInstallRequest {
  readonly source: string
  readonly destination: string
  readonly legacyDestination?: string
  readonly expectedBundleId: string
  readonly expectedVersion: string
}

/** Platform operations separated from the filesystem replacement transaction. */
export interface LocalMacInstallOperations {
  readonly copyApp: (source: string, destination: string) => Promise<void>
  readonly readMetadata: (app: string) => Promise<LocalMacApplicationMetadata>
  readonly stopApp: (bundleId: string) => Promise<void>
  readonly launchAndVerify: (app: string, bundleId: string) => Promise<void>
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function verifyMetadata(
  metadata: LocalMacApplicationMetadata,
  expectedBundleId: string,
  expectedVersion: string,
): void {
  if (metadata.bundleId !== expectedBundleId) {
    throw new Error(`desktop local install: expected bundle ID ${expectedBundleId}, received ${metadata.bundleId}`)
  }
  if (metadata.version !== expectedVersion) {
    throw new Error(`desktop local install: expected version ${expectedVersion}, received ${metadata.version}`)
  }
}

/**
 * Replace one installed local application after staging validation and restore the previous app on failure.
 * @param request - Source artifact, installation destination, and required application identity.
 * @param operations - macOS copy, metadata, process stop, and verified launch operations.
 * @returns Metadata read back from the installed application.
 */
export async function installLocalMacOSApplication(
  request: LocalMacInstallRequest,
  operations: LocalMacInstallOperations,
): Promise<LocalMacApplicationMetadata> {
  const source = await stat(request.source)
  if (!source.isDirectory()) throw new Error(`desktop local install: application artifact is not a directory: ${request.source}`)

  const suffix = randomUUID()
  const staging = join(dirname(request.destination), `.${basename(request.destination)}.install-${suffix}`)
  const backup = join(dirname(request.destination), `.${basename(request.destination)}.backup-${suffix}`)
  let backupExists = false
  let installed = false

  try {
    await operations.copyApp(request.source, staging)
    verifyMetadata(await operations.readMetadata(staging), request.expectedBundleId, request.expectedVersion)
    const destinationExists = await exists(request.destination)
    const legacyExists = request.legacyDestination !== undefined
      && request.legacyDestination !== request.destination
      && await exists(request.legacyDestination)
    if (destinationExists && legacyExists) {
      throw new Error(`desktop local install: both ${request.destination} and ${request.legacyDestination} exist`)
    }
    const previous = destinationExists ? request.destination : legacyExists ? request.legacyDestination : undefined
    await operations.stopApp(request.expectedBundleId)

    if (previous !== undefined) {
      await rename(previous, backup)
      backupExists = true
    }

    try {
      await rename(staging, request.destination)
      installed = true
      const metadata = await operations.readMetadata(request.destination)
      verifyMetadata(metadata, request.expectedBundleId, request.expectedVersion)
      await operations.launchAndVerify(request.destination, request.expectedBundleId)
      if (backupExists) {
        await rm(backup, { recursive: true })
        backupExists = false
      }
      return metadata
    } catch (failure) {
      if (installed) await rm(request.destination, { recursive: true, force: true })
      if (backupExists) {
        try {
          const restoreDestination = previous ?? request.destination
          await rename(backup, restoreDestination)
          backupExists = false
          await operations.launchAndVerify(restoreDestination, request.expectedBundleId)
        } catch (restoreFailure) {
          throw new AggregateError([failure, restoreFailure], 'desktop local install: installation and rollback failed')
        }
      }
      throw failure
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function run(command: string, args: readonly string[], cwd?: string): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`desktop local install: ${command} exited with ${code ?? signal ?? 'unknown status'}`))
    })
  })
}

async function readMetadata(app: string): Promise<LocalMacApplicationMetadata> {
  const plist = join(app, 'Contents', 'Info.plist')
  const [bundleId, version] = await Promise.all([
    execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist]),
    execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]),
  ])
  return { bundleId: bundleId.stdout.trim(), version: version.stdout.trim() }
}

async function isRunning(bundleId: string): Promise<boolean> {
  const script = [
    'on run argv',
    'tell application "System Events" to return exists (first application process whose bundle identifier is item 1 of argv)',
    'end run',
  ]
  const result = await execute('/usr/bin/osascript', script.flatMap(line => ['-e', line]).concat(bundleId))
  return result.stdout.trim() === 'true'
}

async function waitForRunning(bundleId: string, expected: boolean): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (await isRunning(bundleId) === expected) return
    await new Promise(resolveWait => setTimeout(resolveWait, 250))
  }
  throw new Error(`desktop local install: application ${expected ? 'did not start' : 'did not stop'} within 15 seconds`)
}

const macOperations: LocalMacInstallOperations = {
  async copyApp(source, destination) {
    await execute('/usr/bin/ditto', [source, destination])
  },
  readMetadata,
  async stopApp(bundleId) {
    if (!await isRunning(bundleId)) return
    await execute('/usr/bin/osascript', ['-e', `tell application id "${bundleId}" to quit`])
    await waitForRunning(bundleId, false)
  },
  async launchAndVerify(app, bundleId) {
    await execute('/usr/bin/open', [app])
    await waitForRunning(bundleId, true)
  },
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw new Error('desktop local install: this entry requires Apple Silicon macOS')
  }
  const desktopRoot = resolve(import.meta.dirname, '..')
  const manifest = JSON.parse(await readFile(join(desktopRoot, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error('desktop local install: apps/desktop/package.json has no version')
  }
  await run('pnpm', ['run', 'package:mac:arm64:local'], desktopRoot)
  const source = join(desktopRoot, '.desktop-build', 'targets', 'mac-arm64', 'local-artifacts', 'mac-arm64', LOCAL_APP_NAME)
  const destination = join('/Applications', LOCAL_APP_NAME)
  const metadata = await installLocalMacOSApplication({
    source,
    destination,
    legacyDestination: join('/Applications', LEGACY_LOCAL_APP_NAME),
    expectedBundleId: LOCAL_APP_ID,
    expectedVersion: manifest.version,
  }, macOperations)
  process.stdout.write(`desktop local install: installed ${metadata.version} (${metadata.bundleId}) at ${destination}\n`)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
