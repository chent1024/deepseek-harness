/** Real Chromium cookies and native welcome requests against an isolated loopback Host. */
import { app, net, session } from 'electron'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'

async function run() {
  const [welcomeModule, documentModule, userData] = process.argv.slice(2)
  app.setPath('userData', userData)
  await app.whenReady()
  const { connectDesktopWelcome } = await import(pathToFileURL(welcomeModule).href)
  const { authenticateWebHost } = await import(pathToFileURL(documentModule).href)
  const cookie = 'dsh-auth-' + 'z'.repeat(43) + '=' + 'c'.repeat(173)
  const account = { status: 'signed-out', attempt: null,
    links: { usageUrl: 'https://platform.example/usage', topUpUrl: 'https://platform.example/top_up' } }
  let overflows = 0
  let authenticatedRequests = 0
  let authenticatedStreams = 0
  const server = createServer((request, response) => {
    if (request.url === '/?token=fixture') {
      response.writeHead(303, { location: './', 'set-cookie': cookie + '; HttpOnly; SameSite=Strict; Path=/' }).end()
      return
    }
    if (request.headers.cookie !== cookie) { response.writeHead(401).end(); return }
    authenticatedRequests++
    if (request.url === '/') { response.end('index'); return }
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const { rpcId, method } = JSON.parse(body)
      const value = method === 'settings/describe' ? { namespaces: [{ ns: 'locale', value: { preference: 'zh' } }] }
        : method === 'llm/listConfigurableProviders' ? [] : account
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }))
    })
  })
  server.on('clientError', (error, socket) => {
    if (error.code === 'HPE_HEADER_OVERFLOW') overflows++
    socket.end('HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  })
  const streams = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    if (request.headers.cookie !== cookie) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return }
    authenticatedStreams++
    streams.handleUpgrade(request, socket, head, connection => {
      connection.on('message', data => {
        const frame = JSON.parse(data.toString())
        if (frame.type === 'open' && frame.endpoint === 'account/watch') {
          connection.send(JSON.stringify({ type: 'item', streamId: frame.streamId, value: account }))
        }
      })
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/?token=fixture`
  let stop
  try {
    // Previous ephemeral Host ports leave authority-specific cookies on the same loopback host.
    for (let index = 0; index < 70; index++) {
      await session.defaultSession.cookies.set({ url, name: 'dsh-auth-' + String(index).padStart(43, 'a'),
        value: 'b'.repeat(173), httpOnly: true, sameSite: 'strict', expirationDate: Date.now() / 1000 + 3600 })
    }
    const ownedCookie = await authenticateWebHost(url)
    const legacy = await net.fetch(url, { credentials: 'include', signal: AbortSignal.timeout(10_000) })
    await legacy.body?.cancel()
    const backend = await connectDesktopWelcome(url, ownedCookie)
    const state = await backend.read()
    const snapshot = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('account stream timed out')), 10_000)
      stop = backend.account.watch(value => { clearTimeout(timer); resolve(value) },
        () => { clearTimeout(timer); reject(new Error('account stream failed')) }, () => {})
    })
    const rejected = await connectDesktopWelcome(url, 'invalid=fixture').then(() => false, () => true)
    console.log('WELCOME_AUTH_RESULT ' + JSON.stringify({ legacyStatus: legacy.status, overflows,
      authenticatedRequests, authenticatedStreams, state, snapshot, rejected,
      staleCookies: (await session.defaultSession.cookies.get({ url })).length }))
  } finally {
    stop?.()
    for (const connection of streams.clients) connection.terminate()
    await new Promise(resolve => streams.close(resolve))
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

run().then(() => app.quit(), error => { console.error(error); app.exit(1) })
