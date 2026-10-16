/** Sandboxed playback signals; no filesystem paths or Host access reach the document. */
import { ipcRenderer } from 'electron'
import { DESKTOP_IPC } from './ipc.ts'

document.addEventListener('DOMContentLoaded', () => {
  const report = (state: string): void => { ipcRenderer.send(DESKTOP_IPC.startupPlayback, state) }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { report('reduced-motion'); return }
  const video = document.querySelector('video')
  let frame: number | undefined
  const tail = (): void => {
    if (video === null || video.ended || video.paused || !Number.isFinite(video.duration) || video.duration < 7) return
    const remaining = (video.duration - video.currentTime) * 1000
    if (remaining > 0 && remaining <= 2000) ipcRenderer.send(DESKTOP_IPC.startupPlayback, 'tail', remaining)
  }
  const tick = (): void => { tail(); frame = requestAnimationFrame(tick) }
  const ended = (): void => {
    if (frame !== undefined) cancelAnimationFrame(frame)
    report('ended')
  }
  video?.addEventListener('playing', () => { report('playing') }, { once: true })
  video?.addEventListener('ended', ended, { once: true })
  video?.addEventListener('timeupdate', tail)
  video?.addEventListener('error', () => { report('error') }, { once: true })
  if (video?.error !== null && video?.error !== undefined) report('error')
  else if (video?.ended === true) { report('playing'); report('ended') }
  else if (video !== null && video.readyState >= 2 && !video.paused) report('playing')
  if (video !== null && !video.ended) frame = requestAnimationFrame(tick)
})
