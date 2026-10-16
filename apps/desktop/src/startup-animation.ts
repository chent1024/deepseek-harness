/** Local startup window; Host initialization and client mounting run concurrently with playback. */
import { randomInt } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, ipcMain, net, screen } from 'electron'
import { DESKTOP_IPC, SCHEME, assertDesktopSender } from './ipc.ts'

type WorkspaceWindow = Pick<BrowserWindow, 'show' | 'showInactive' | 'isDestroyed'> & {
  readonly webContents: Pick<Electron.WebContents, 'setBackgroundThrottling'>
}

/** Minimum visible playback required by the Desktop startup presentation. */
const MINIMUM_PLAYBACK_MS = 7000

/** Own one randomly selected video and the handoff after playback and client readiness. */
export class DesktopStartupAnimation {
  private window: BrowserWindow | undefined
  private pending: { window: WorkspaceWindow; activate: boolean } | undefined
  private mounted = false
  private playing = false
  private ended = false
  private minimumElapsed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private readonly resource: string

  /**
   * @param resources - Nonempty pool of bundled local videos; selected once for this process.
   * @param preload - Bundled sandboxed playback preload.
   */
  constructor(resources: readonly [string, ...string[]], private readonly preload: string) {
    // randomInt has an exclusive upper bound, and the tuple is nonempty.
    this.resource = resources[randomInt(resources.length)] as string
  }

  /** Start without awaiting Host startup; ordinary navigation never calls this again. */
  start(): void {
    const bounds = screen.getPrimaryDisplay().workArea
    const window = new BrowserWindow({ ...bounds, show: false, frame: false,
      backgroundColor: '#000000', webPreferences: { preload: this.preload, sandbox: true,
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    this.window = window
    const beginMinimum = (): void => {
      if (!this.playing || !window.isVisible() || this.timer !== undefined || this.minimumElapsed) return
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.minimumElapsed = true
        this.tryReveal()
      }, MINIMUM_PLAYBACK_MS)
    }
    const playback = (event: Electron.IpcMainEvent, state: unknown): void => {
      assertDesktopSender(event, ['startup'])
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return
      if (state === 'playing') { this.playing = true; beginMinimum() }
      else if (state === 'ended') { this.ended = true; this.tryReveal() }
      else if (state === 'error' || state === 'reduced-motion') this.finish(true)
      else throw new Error('Desktop startup: invalid playback signal')
    }
    ipcMain.on(DESKTOP_IPC.startupPlayback, playback)
    window.once('closed', () => {
      ipcMain.off(DESKTOP_IPC.startupPlayback, playback)
      this.clearTimer()
      this.window = undefined
    })
    window.on('close', (event) => { event.preventDefault() })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => { event.preventDefault() })
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) { window.maximize(); window.show(); beginMinimum() }
    })
    void window.loadURL(`${SCHEME}://startup/`).catch((error: unknown) => {
      console.warn('Desktop startup animation failed:', error instanceof Error ? error.name : 'load failure')
      this.finish(true)
    })
  }

  /**
   * Serve only the selected bundled video and its isolated local document.
   * @param request - Desktop protocol request for the startup hostname.
   * @returns The local response; unrelated paths and methods are unavailable.
   */
  response(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== 'GET' && request.method !== 'HEAD') return Promise.resolve(new Response(null, { status: 405 }))
    if (url.pathname === '/video') {
      return net.fetch(pathToFileURL(this.resource).href, { method: request.method, headers: request.headers })
    }
    if (url.pathname !== '/') return Promise.resolve(new Response(null, { status: 404 }))
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>
      html,body{margin:0;width:100%;height:100%;background:#000;overflow:hidden}video{display:block;width:100%;height:100%;object-fit:contain}
      </style></head><body><video aria-hidden="true" muted autoplay playsinline src="${SCHEME}://startup/video"></video></body></html>`
    return Promise.resolve(new Response(request.method === 'HEAD' ? null : html, { headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'content-security-policy': `default-src 'none'; media-src ${SCHEME}:; style-src 'unsafe-inline'`,
    } }))
  }

  /**
   * Preserve activation while awaiting successful mount and completed playback.
   * @param window - Owned workspace or loaded Welcome window.
   * @param activate - Whether entering the destination should focus it.
   */
  reveal(window: WorkspaceWindow, activate: boolean): void {
    if (this.window !== undefined && !(this.mounted && this.ended && this.minimumElapsed)) {
      window.webContents.setBackgroundThrottling(false)
      this.pending = { window, activate }
      return
    }
    window.webContents.setBackgroundThrottling(true)
    if (activate) window.show()
    else window.showInactive()
    this.finish()
  }

  /**
   * Keep activation on the startup window until handoff.
   * @returns Whether a live startup window handled activation.
   */
  focus(): boolean {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return false
    window.show()
    window.focus()
    return true
  }

  /** Acknowledge successful client mount; Host readiness alone cannot reveal the workspace. */
  workspaceMounted(): void { this.mounted = true; this.tryReveal() }

  /**
   * Present a loaded Welcome window after the same minimum playback.
   * @param window - Loaded Welcome window that has not yet been shown.
   */
  welcomeReady(window: WorkspaceWindow): void { this.mounted = true; this.reveal(window, true) }

  private tryReveal(): void {
    if (!this.mounted || !this.ended || !this.minimumElapsed) return
    const pending = this.pending
    this.pending = undefined
    if (pending !== undefined && !pending.window.isDestroyed()) this.reveal(pending.window, pending.activate)
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /**
   * Close during handoff, recovery, media failure, reduced motion, or quit.
   * @param revealPending - Continue with the normal loading page after a media failure or reduced motion.
   */
  finish(revealPending = false): void {
    this.clearTimer()
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
    const pending = this.pending
    this.pending = undefined
    if (pending !== undefined && !pending.window.isDestroyed()) {
      pending.window.webContents.setBackgroundThrottling(true)
      if (revealPending) {
        if (pending.activate) pending.window.show()
        else pending.window.showInactive()
      }
    }
  }
}
