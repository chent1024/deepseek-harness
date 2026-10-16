/** Real Electron qualification of every bundled video with isolated user data. */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, protocol, screen, ipcMain } from 'electron'
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
  for (const scenario of ['cyberpunk', 'awakening', 'late-mount', 'error']) {
    const clip = scenario === 'late-mount' ? 'cyberpunk' : scenario
    const workspace = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    workspace.once('show', () => { workspace.maximize() })
    try {
      await workspace.loadURL('data:text/html,<main>Workspace mounted</main>')
      animation = new DesktopStartupAnimation([join(root, 'resources', clip === 'error' ? 'missing.mp4' : `startup-animation-${clip}.mp4`)],
        join(root, 'lib/preload-startup.cjs'))
      const workspaceMaximized = clip === 'error' ? undefined : once(workspace, 'maximize')
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
      writeFileSync(join(screenshots, `${scenario}.png`), (await splash.webContents.capturePage()).toPNG())
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
      assert.deepEqual(bounds, screen.getPrimaryDisplay().workArea)
      assert.equal(splash.isMaximized(), true)
      assert.equal(splash.isFullScreen(), false)
      let ended = false
      const observeEnded = (_event, state) => { if (state === 'ended') ended = true }
      ipcMain.on('dsh-desktop:startup-playback', observeEnded)
      splash.once('closed', () => ipcMain.off('dsh-desktop:startup-playback', observeEnded))
      if (scenario === 'late-mount') {
        await splash.webContents.executeJavaScript(`new Promise(resolve => {
          const video = document.querySelector('video');
          video.addEventListener('ended', () => resolve(), {once:true});
        })`)
        assert.equal(workspace.isVisible(), false)
        assert.equal(splash.getOpacity(), 1)
      }
      animation.workspaceMounted()
      if (scenario !== 'late-mount') assert.equal(workspace.isVisible(), false)
      const opacity = await new Promise((resolve, reject) => {
        const poll = () => {
          if (splash.isDestroyed()) { reject(new Error('Startup closed without dissolving')); return }
          if (splash.getOpacity() < 0.8) resolve(splash.getOpacity())
          else setTimeout(poll, 16)
        }
        poll()
      })
      assert.ok(opacity > 0 && opacity < 1)
      assert.equal(workspace.isVisible(), true)
      const stillPlaying = await splash.webContents.executeJavaScript(`!document.querySelector('video').ended`)
      assert.equal(stillPlaying, scenario !== 'late-mount')
      await closed
      assert.equal(ended, true)
      const minimum = performance.now() - started >= 7000
      assert.equal(minimum, true)
      await workspaceMaximized
      assert.equal(workspace.isVisible(), true)
      assert.equal(workspace.isMaximized(), true)
      assert.equal(workspace.isFullScreen(), false)
      animation.reveal(workspace, true)
      animation.workspaceMounted()
      results.push({ clip: scenario, played, minimum, maximized: true, workspaceMaximized: true, uncropped: true, tailDissolve: scenario !== 'late-mount', lateDissolve: scenario === 'late-mount', fullPlayback: true, closed: splash.isDestroyed(),
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
