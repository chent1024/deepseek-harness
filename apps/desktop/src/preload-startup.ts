/** Sandboxed playback signals; no filesystem paths or Host access reach the document. */
import { ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'

document.addEventListener('DOMContentLoaded', () => {
  const report = (state: string): void => { ipcRenderer.send(DESKTOP_IPC.startupPlayback, state) }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { report('reduced-motion'); return }
  const video = document.querySelector('video')
  video?.addEventListener('playing', () => { report('playing') }, { once: true })
  video?.addEventListener('ended', () => { report('ended') }, { once: true })
  video?.addEventListener('error', () => { report('error') }, { once: true })
  if (video?.error !== null && video?.error !== undefined) report('error')
  else if (video?.ended === true) { report('playing'); report('ended') }
  else if (video !== null && video.readyState >= 2 && !video.paused) report('playing')
})
