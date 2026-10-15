/** Real Electron qualification of every bundled video with isolated user data. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, protocol, screen } from 'electron'
import { DesktopStartupAnimation } from '../../lib/types/startup-animation.js'

const root = fileURLToPath(new URL('../..', import.meta.url))
const screenshots = join(root, '.desktop-build/qualification', `startup-framing-${Date.now()}`)
mkdirSync(screenshots, { recursive: true })
const temporary = mkdtempSync(join(tmpdir(), 'dsh-startup-qualification-'))
app.setPath('userData', temporary)
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true,
} }])
app.on('window-all-closed', () => {})
let animation
let timer
const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Startup qualification timed out')), 45_000) })

async function check() {
  await app.whenReady()
  protocol.handle('dsh-app', request => animation.response(request))
  const results = []
  for (const clip of ['brand', 'cyberpunk', 'awakening', 'error']) {
    const workspace = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await workspace.loadURL('data:text/html,<main>Workspace mounted</main>')
      animation = new DesktopStartupAnimation([join(root, 'resources', clip === 'error' ? 'missing.mp4' : `startup-animation-${clip}.mp4`)],
        join(root, 'lib/preload-startup.cjs'))
      const started = performance.now()
      animation.start()
      const splash = BrowserWindow.getAllWindows().find(window => window !== workspace)
      assert.ok(splash)
      const closed = once(splash, 'closed')
      animation.reveal(workspace, false)
      if (clip === 'error') {
        await closed
        results.push({ clip, closed: splash.isDestroyed(), continued: workspace.isVisible() })
        continue
      }
      await once(splash.webContents, 'did-finish-load')
      const played = await splash.webContents.executeJavaScript(`new Promise(resolve => {
        const video = document.querySelector('video');
        if (video.readyState >= 2 && !video.paused) resolve(true);
        else { video.addEventListener('playing', () => resolve(true), {once:true}); video.addEventListener('error', () => resolve(false), {once:true}); }
      })`)
      assert.equal(played, true)
      await splash.webContents.executeJavaScript(`new Promise(resolve => {
        const video = document.querySelector('video');
        if (video.currentTime >= 2) resolve();
        else video.addEventListener('timeupdate', function tick() { if (video.currentTime >= 2) { video.removeEventListener('timeupdate', tick); resolve(); } });
      })`)
      writeFileSync(join(screenshots, `${clip}.png`), (await splash.webContents.capturePage()).toPNG())
      const geometry = await splash.webContents.executeJavaScript(`(() => {
        const video = document.querySelector('video');
        const rect = video.getBoundingClientRect();
        return { width: video.videoWidth, height: video.videoHeight, fit: getComputedStyle(video).objectFit,
          left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight };
      })()`)
      assert.equal(geometry.fit, 'contain')
      assert.equal(geometry.width / geometry.height, 16 / 9)
      assert.ok(geometry.left >= 0 && geometry.top >= 0 && geometry.right <= geometry.viewportWidth && geometry.bottom <= geometry.viewportHeight)
      const bounds = splash.getBounds()
      const area = screen.getPrimaryDisplay().workArea
      assert.ok(bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height)
      animation.workspaceMounted()
      assert.equal(workspace.isVisible(), false)
      await closed
      const minimum = performance.now() - started >= 7000
      assert.equal(minimum, true)
      assert.equal(workspace.isVisible(), true)
      animation.reveal(workspace, true)
      animation.workspaceMounted()
      results.push({ clip, played, minimum, uncropped: true, hiddenUntilCompleted: true, closed: splash.isDestroyed(),
        replayed: BrowserWindow.getAllWindows().some(window => window !== workspace) })
    } finally {
      animation?.finish()
      if (!workspace.isDestroyed()) workspace.destroy()
    }
  }
  const expected = JSON.parse(readFileSync(join(root, 'tests/expected/startup-animation.json'), 'utf8'))
  assert.deepEqual(results, expected)
  console.log('STARTUP_ANIMATION_SCREENSHOTS', screenshots)
  console.log('STARTUP_ANIMATION_RESULT', JSON.stringify(results))
}

async function qualify() {
  try {
    await Promise.race([check(), deadline])
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    clearTimeout(timer)
    animation?.finish()
    if (app.isReady()) for (const window of BrowserWindow.getAllWindows()) window.destroy()
    rmSync(temporary, { recursive: true, force: true })
    app.exit(process.exitCode ?? 0)
  }
}
void qualify()
