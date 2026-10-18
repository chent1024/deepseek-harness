/** Built native welcome transport remains usable with an overflowing Chromium cookie jar. */
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { execa } from 'execa'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const hasDisplay = process.platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY)

it.skipIf(!hasDisplay)('reads welcome state and streams the account using only the current Host cookie', { retry: 0 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-welcome-auth-'))
  try {
    const welcome = join(repository, 'apps/desktop/lib/types/welcome-backend.js')
    const document = join(repository, 'apps/desktop/lib/types/web-document.js')
    if (!existsSync(welcome) || !existsSync(document)) throw new Error('Run pnpm run build:artifacts before the welcome auth smoke')
    const electron: unknown = require('electron')
    if (typeof electron !== 'string') throw new Error('Electron executable is unavailable')
    const fixture = fileURLToPath(new URL('./fixtures/welcome-auth-smoke.mjs', import.meta.url))
    const result = await execa(electron, [fixture, welcome, document, root], {
      env: { ELECTRON_RUN_AS_NODE: undefined }, timeout: 30_000, forceKillAfterDelay: 5_000, reject: false,
    })
    expect(result.timedOut, result.stderr).toBe(false)
    expect(result.signal, result.stderr).toBeUndefined()
    expect(result.exitCode, result.stderr).toBe(0)
    const line = result.stdout.split('\n').find(value => value.startsWith('WELCOME_AUTH_RESULT '))
    if (line === undefined) throw new Error(`Missing welcome auth result: ${result.stdout}\n${result.stderr}`)
    const observed: unknown = JSON.parse(line.slice('WELCOME_AUTH_RESULT '.length))
    expect(observed).toEqual({ legacyStatus: 431, overflows: 1, authenticatedRequests: 4, authenticatedStreams: 1,
      state: { loggedIn: false, hasApiKey: false, writable: false, localePreference: 'zh' },
      snapshot: { status: 'signed-out', attempt: null,
        links: { usageUrl: 'https://platform.example/usage', topUpUrl: 'https://platform.example/top_up' } },
      rejected: true, staleCookies: 71 })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
