import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  installLocalMacOSApplication,
  type LocalMacInstallOperations,
} from '../scripts/install-local-macos.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; source: string; destination: string; legacyDestination: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-local-mac-install-'))
  roots.push(root)
  const source = join(root, 'artifacts', 'DeepSeek.app')
  const destination = join(root, 'Applications', 'DeepSeek.app')
  const legacyDestination = join(root, 'Applications', 'DeepSeek Harness Local.app')
  await mkdir(source, { recursive: true })
  await mkdir(join(root, 'Applications'), { recursive: true })
  await writeFile(join(source, 'version.txt'), '0.1.7-rc.1\n')
  return { root, source, destination, legacyDestination }
}

function operations(events: string[], launchFailure = false): LocalMacInstallOperations {
  return {
    async copyApp(source, destination) {
      events.push(`copy:${source}:${destination}`)
      await cp(source, destination, { recursive: true })
    },
    async readMetadata(app) {
      return {
        bundleId: 'com.deepseek.harness.local',
        version: (await readFile(join(app, 'version.txt'), 'utf8')).trim(),
      }
    },
    async stopApp() {
      events.push('stop')
    },
    async launchAndVerify(app) {
      events.push(`launch:${app}`)
      if (launchFailure && (await readFile(join(app, 'version.txt'), 'utf8')).trim() === '0.1.7-rc.1') {
        throw new Error('launch failed')
      }
    },
  }
}

describe('local macOS application installation', () => {
  it('validates the staged app before replacing and launching the destination', async () => {
    const { source, destination } = await fixture()
    const events: string[] = []

    const installed = await installLocalMacOSApplication({
      source,
      destination,
      expectedBundleId: 'com.deepseek.harness.local',
      expectedVersion: '0.1.7-rc.1',
    }, operations(events))

    expect(installed).toEqual({ bundleId: 'com.deepseek.harness.local', version: '0.1.7-rc.1' })
    expect(await readFile(join(destination, 'version.txt'), 'utf8')).toBe('0.1.7-rc.1\n')
    expect(events.at(-2)).toBe('stop')
    expect(events.at(-1)).toBe(`launch:${destination}`)
  })

  it('restores and relaunches the previous app when the new app does not start', async () => {
    const { source, destination } = await fixture()
    const events: string[] = []
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'version.txt'), '0.1.6-alpha.2\n')

    await expect(installLocalMacOSApplication({
      source,
      destination,
      expectedBundleId: 'com.deepseek.harness.local',
      expectedVersion: '0.1.7-rc.1',
    }, operations(events, true))).rejects.toThrow(/launch failed/u)

    expect(await readFile(join(destination, 'version.txt'), 'utf8')).toBe('0.1.6-alpha.2\n')
    expect(events.at(-1)).toBe(`launch:${destination}`)
  })

  it('replaces the legacy local app name without leaving a duplicate bundle ID', async () => {
    const { source, destination, legacyDestination } = await fixture()
    const events: string[] = []
    await mkdir(legacyDestination, { recursive: true })
    await writeFile(join(legacyDestination, 'version.txt'), '0.1.6-alpha.2\n')

    await installLocalMacOSApplication({
      source,
      destination,
      legacyDestination,
      expectedBundleId: 'com.deepseek.harness.local',
      expectedVersion: '0.1.7-rc.1',
    }, operations(events))

    await expect(readFile(join(legacyDestination, 'version.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(destination, 'version.txt'), 'utf8')).toBe('0.1.7-rc.1\n')
  })

  it('does not stop or replace the installed app when staged metadata is unexpected', async () => {
    const { source, destination } = await fixture()
    const events: string[] = []
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'version.txt'), '0.1.6-alpha.2\n')

    await expect(installLocalMacOSApplication({
      source,
      destination,
      expectedBundleId: 'com.deepseek.harness.local',
      expectedVersion: '0.1.8',
    }, operations(events))).rejects.toThrow(/expected version 0\.1\.8/u)

    expect(await readFile(join(destination, 'version.txt'), 'utf8')).toBe('0.1.6-alpha.2\n')
    expect(events).not.toContain('stop')
  })

  it('refuses an ambiguous install when both current and legacy app names exist', async () => {
    const { source, destination, legacyDestination } = await fixture()
    const events: string[] = []
    await mkdir(destination, { recursive: true })
    await mkdir(legacyDestination, { recursive: true })
    await writeFile(join(destination, 'version.txt'), '0.1.7-rc.1\n')
    await writeFile(join(legacyDestination, 'version.txt'), '0.1.6-alpha.2\n')

    await expect(installLocalMacOSApplication({
      source,
      destination,
      legacyDestination,
      expectedBundleId: 'com.deepseek.harness.local',
      expectedVersion: '0.1.7-rc.1',
    }, operations(events))).rejects.toThrow(/both .*DeepSeek\.app.*DeepSeek Harness Local\.app/u)

    expect(events).not.toContain('stop')
    expect(await readFile(join(destination, 'version.txt'), 'utf8')).toBe('0.1.7-rc.1\n')
    expect(await readFile(join(legacyDestination, 'version.txt'), 'utf8')).toBe('0.1.6-alpha.2\n')
  })
})
