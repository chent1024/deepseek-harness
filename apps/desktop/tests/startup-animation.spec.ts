import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DESKTOP_IPC } from '../src/ipc.ts'
import { DesktopStartupAnimation } from '../src/startup-animation.ts'

const native = vi.hoisted(() => ({
  createWindow: vi.fn<(options: Electron.BrowserWindowConstructorOptions) => TestWindow>(),
  on: vi.fn(), off: vi.fn(), fetch: vi.fn(), randomInt: vi.fn(), display: vi.fn(),
}))
vi.mock('node:crypto', () => ({ randomInt: native.randomInt }))
vi.mock('electron', () => ({
  BrowserWindow: function (options: Electron.BrowserWindowConstructorOptions) { return native.createWindow(options) },
  screen: { getPrimaryDisplay: native.display },
  ipcMain: { on: native.on, off: native.off }, net: { fetch: native.fetch },
}))

class TestWindow extends EventEmitter {
  destroyed = false
  visible = false
  readonly webContents = Object.assign(new EventEmitter(), {
    mainFrame: { url: 'dsh-app://startup/' }, setWindowOpenHandler: vi.fn(), setBackgroundThrottling: vi.fn(),
  })
  readonly focus = vi.fn()
  readonly show = vi.fn(() => { this.visible = true })
  readonly showInactive = vi.fn(() => { this.visible = true })
  readonly loadURL = vi.fn(async () => {})
  readonly destroy = vi.fn(() => { this.destroyed = true; this.emit('closed') })
  isDestroyed(): boolean { return this.destroyed }
  isVisible(): boolean { return this.visible }
}

let splash: TestWindow
let workspace: TestWindow
let animation: DesktopStartupAnimation
beforeEach(() => {
  vi.useFakeTimers()
  native.display.mockReturnValue({ workArea: { x: 0, y: 25, width: 1440, height: 850 } })
  native.randomInt.mockReturnValue(0)
  splash = new TestWindow()
  workspace = new TestWindow()
  native.createWindow.mockReturnValue(splash)
  animation = new DesktopStartupAnimation(['/bundled/startup.mp4'], '/bundled/preload.cjs')
})
afterEach(() => { animation.finish(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.clearAllMocks() })

function playback(state: string, sender = splash): void {
  const callback = native.on.mock.calls.find(([name]) => name === DESKTOP_IPC.startupPlayback)![1] as (event: object, state: string) => void
  callback({ sender: sender.webContents, senderFrame: sender.webContents.mainFrame }, state)
}
function visiblePlayback(): void {
  animation.start()
  splash.emit('ready-to-show')
  playback('playing')
}

it('waits for seven visible seconds and the full video even when the workspace mounts early', () => {
  visiblePlayback()
  animation.reveal(workspace, false)
  animation.workspaceMounted()
  expect(workspace.showInactive).not.toHaveBeenCalled()
  expect(workspace.webContents.setBackgroundThrottling).toHaveBeenCalledWith(false)
  vi.advanceTimersByTime(7000)
  expect(splash.destroy).not.toHaveBeenCalled()
  playback('ended')
  expect(workspace.showInactive).toHaveBeenCalledOnce()
  expect(workspace.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true)
  expect(splash.destroy).toHaveBeenCalledOnce()
  animation.reveal(workspace, true)
  animation.workspaceMounted()
  expect(native.createWindow).toHaveBeenCalledOnce()
})

it('does not shorten the seven seconds when a clip ends early', () => {
  visiblePlayback()
  animation.reveal(workspace, true)
  animation.workspaceMounted()
  playback('ended')
  vi.advanceTimersByTime(6999)
  expect(workspace.show).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(workspace.show).toHaveBeenCalledOnce()
})

it('waits for late workspace mount after playback and the minimum have completed', () => {
  visiblePlayback()
  animation.reveal(workspace, true)
  playback('ended')
  vi.advanceTimersByTime(7000)
  expect(splash.destroy).not.toHaveBeenCalled()
  animation.workspaceMounted()
  expect(splash.destroy).toHaveBeenCalledOnce()
})

it('starts the minimum only after playback is visible and does not reset it on repeated playing signals', () => {
  animation.start()
  animation.reveal(workspace, true)
  animation.workspaceMounted()
  playback('playing')
  vi.advanceTimersByTime(7000)
  expect(splash.destroy).not.toHaveBeenCalled()
  splash.emit('ready-to-show')
  playback('ended')
  vi.advanceTimersByTime(6000)
  playback('playing')
  vi.advanceTimersByTime(1000)
  expect(splash.destroy).toHaveBeenCalledOnce()
})

it('retains the loaded Welcome window until the same minimum and video completion', () => {
  visiblePlayback()
  animation.welcomeReady(workspace)
  playback('ended')
  vi.advanceTimersByTime(6999)
  expect(workspace.show).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(workspace.show).toHaveBeenCalledOnce()
})

it('releases the timer and IPC without revealing a pending workspace during recovery or quit', () => {
  visiblePlayback()
  animation.reveal(workspace, true)
  animation.finish()
  expect(workspace.show).not.toHaveBeenCalled()
  expect(splash.destroy).toHaveBeenCalledOnce()
  expect(native.off).toHaveBeenCalledWith(DESKTOP_IPC.startupPlayback, expect.any(Function))
  splash.emit('ready-to-show')
  expect(splash.show).toHaveBeenCalledTimes(1)
})

it.each(['error', 'reduced-motion'])('allows %s only from the owned startup frame', (state) => {
  animation.start()
  animation.reveal(workspace, true)
  playback(state, workspace)
  expect(splash.destroy).not.toHaveBeenCalled()
  playback(state)
  expect(splash.destroy).toHaveBeenCalledOnce()
  expect(workspace.show).toHaveBeenCalledOnce()
})

it.each([0, 1, 2])('selects pool entry %i once and keeps the same media for all requests', async (index) => {
  native.randomInt.mockClear().mockReturnValue(index)
  animation = new DesktopStartupAnimation(['/brand.mp4', '/cyberpunk.mp4', '/awakening.mp4'], '/preload.cjs')
  native.fetch.mockImplementation(async () => new Response('video'))
  for (let request = 0; request < 2; request++) {
    await animation.response(new Request('dsh-app://startup/video'))
    expect(native.fetch).toHaveBeenLastCalledWith(['file:///brand.mp4', 'file:///cyberpunk.mp4', 'file:///awakening.mp4'][index], expect.any(Object))
  }
  expect(native.randomInt).toHaveBeenCalledExactlyOnceWith(3)
})

it('denies unrelated resource paths and methods', async () => {
  expect((await animation.response(new Request('dsh-app://startup/other'))).status).toBe(404)
  expect((await animation.response(new Request('dsh-app://startup/', { method: 'POST' }))).status).toBe(405)
  expect(native.fetch).not.toHaveBeenCalled()
})

it('keeps activation on the startup window until handoff', () => {
  animation.start()
  expect(animation.focus()).toBe(true)
  expect(splash.focus).toHaveBeenCalledOnce()
  animation.finish()
  expect(animation.focus()).toBe(false)
})

it('centers the complete 16:9 presentation inside a smaller display work area', async () => {
  native.display.mockReturnValue({ workArea: { x: -1024, y: 30, width: 1024, height: 600 } })
  animation.start()
  expect(native.createWindow).toHaveBeenCalledWith(expect.objectContaining({ width: 1024, height: 576, x: -1024, y: 42 }))
  const html = await (await animation.response(new Request('dsh-app://startup/'))).text()
  expect(html).toContain('object-fit:contain')
})
