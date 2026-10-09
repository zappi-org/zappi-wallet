#!/usr/bin/env node
/**
 * NIP-46 test client (the "website" side) — for exercising Zappi as a remote signer.
 *
 *   node scripts/nip46-test-client.mjs [--port 8787] [--relays wss://a,wss://b]
 *
 * Flow (client-initiated `nostrconnect://`):
 *   1. generate an ephemeral client keypair + secret
 *   2. print/serve the nostrconnect URI
 *   3. paste it into Zappi (Settings → 지갑 → 웹로그인 & 원격 서명 → 붙혀넣기)
 *   4. Zappi approves → we learn the signer pubkey from the connect ack
 *   5. fire requests from the control page and watch responses
 *
 * Zero build, no extra deps: relays are the only network requirement.
 * ponytail: plain HTTP + polling page; QR display omitted (Zappi's paste path is the entry).
 */
import { createServer } from 'node:http'
import {
  SimplePool,
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip44,
  verifyEvent,
} from 'nostr-tools'
import { useWebSocketImplementation } from 'nostr-tools/pool'

if (typeof globalThis.WebSocket !== 'undefined') {
  useWebSocketImplementation(globalThis.WebSocket)
}

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const eq = args.find((a) => a.startsWith(`--${name}=`))
  if (eq) return eq.slice(name.length + 3)
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const PORT = Number(arg('port', process.env.PORT ?? '8787'))
const RELAYS = arg('relays', process.env.NIP46_RELAYS ?? 'wss://nos.lol,wss://bitcoiner.social')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const REQUEST_TIMEOUT_MS = 30_000

const clientPriv = generateSecretKey()
const clientPub = getPublicKey(clientPriv)
const secret = Math.random().toString(36).slice(2, 12)
const perms = 'get_public_key,sign_event:22242' // sign_event:1 intentionally out-of-perm → approval modal
// Client icon carried in the URI (`image` param) — exercises the approval card avatar.
// Percent-encoded so the data URI survives URLSearchParams round-tripping intact.
const IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'>" +
      "<rect width='96' height='96' rx='22' fill='#6366f1'/>" +
      "<text x='48' y='63' font-size='46' text-anchor='middle' fill='white' font-family='sans-serif' font-weight='700'>T</text>" +
      '</svg>',
  )

const uri = `nostrconnect://${clientPub}?${new URLSearchParams({
  relay: RELAYS[0],
  secret,
  perms,
  name: 'NIP-46 Test Site',
  url: 'http://localhost:' + PORT,
  image: IMAGE,
}).toString()}${RELAYS.slice(1)
  .map((r) => `&relay=${encodeURIComponent(r)}`)
  .join('')}`

const pool = new SimplePool()
const state = {
  connected: false,
  signerPubkey: null,
  userPubkey: null,
  log: [],
}
const pushLog = (msg) => {
  const line = `${new Date().toISOString().slice(11, 19)}  ${msg}`
  state.log.push(line)
  if (state.log.length > 300) state.log.shift()
  process.stdout.write(line + '\n')
}

const pending = new Map() // request id → { resolve, reject, timer }
let sub = null

// ─── Inbound: connect ack + responses ───
const onEvent = (ev) => {
  if (ev.kind !== 24133 || !verifyEvent(ev)) return
  let payload
  try {
    payload = JSON.parse(nip44.v2.decrypt(ev.content, nip44.v2.utils.getConversationKey(clientPriv, ev.pubkey)))
  } catch {
    return
  }

  // First valid message is the connect ack — learn + pin the signer pubkey.
  if (!state.signerPubkey) {
    if (payload.result === secret) {
      state.signerPubkey = ev.pubkey
      state.connected = true
      pushLog(`connected: signer=${ev.pubkey}`)
    } else {
      pushLog(`connect ack secret mismatch: ${JSON.stringify(payload)}`)
    }
    return
  }

  if (ev.pubkey !== state.signerPubkey) return
  const p = pending.get(payload.id)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(payload.id)
  p.resolve(payload)
}

const start = () => {
  sub = pool.subscribe(RELAYS, { kinds: [24133], '#p': [clientPub] }, { onevent: onEvent })
  pushLog(`subscribed on ${RELAYS.join(', ')}`)
}

// ─── Outbound requests ───
const send = (method, params) =>
  new Promise((resolve, reject) => {
    if (!state.signerPubkey) return reject(new Error('not connected yet'))
    const id = Math.random().toString(36).slice(2, 10)
    const content = nip44.v2.encrypt(
      JSON.stringify({ id, method, params }),
      nip44.v2.utils.getConversationKey(clientPriv, state.signerPubkey),
    )
    const event = finalizeEvent(
      { kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [['p', state.signerPubkey]], content },
      clientPriv,
    )
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`timeout: ${method}`))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    Promise.allSettled(pool.publish(RELAYS, event)).then((rs) => {
      const ok = rs.filter((r) => r.status === 'fulfilled').length
      pushLog(`→ ${method} (id=${id}, published ${ok}/${RELAYS.length})`)
    })
  })

const handleRequest = async (method) => {
  if (method === 'get_public_key') {
    const res = await send('get_public_key', [])
    if (res.error) throw new Error(res.error)
    state.userPubkey = res.result
    pushLog(`← get_public_key: ${res.result}`)
    return
  }
  if (method.startsWith('sign_event')) {
    const kind = Number(method.split(':')[1] ?? '22242')
    if (!state.userPubkey) throw new Error('run get_public_key first (need user pubkey)')
    const unsigned = {
      kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: kind === 22242 ? [['relay', RELAYS[0]], ['challenge', 'nip46-test']] : [],
      content: kind === 22242 ? '' : 'hello from the NIP-46 test client',
      pubkey: state.userPubkey,
    }
    const res = await send('sign_event', [JSON.stringify(unsigned)])
    if (res.error) {
      pushLog(`← sign_event(${kind}) DENIED: ${res.error}`)
      return
    }
    pushLog(`← sign_event(${kind}): id=${JSON.parse(res.result).id}`)
    return
  }
  // ping / logout / anything else
  const res = await send(method, [])
  pushLog(`← ${method}: ${res.error ? 'error=' + res.error : res.result}`)
  if (method === 'logout') {
    state.connected = false
    state.signerPubkey = null
  }
}

// ─── Control page ───
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>NIP-46 test client</title>
<style>
body{font-family:system-ui,sans-serif;margin:2rem;max-width:880px;color:#18181b}
code,pre{background:#f4f4f5;padding:.2rem .4rem;border-radius:6px;word-break:break-all}
button{margin:0 .5rem .5rem 0;padding:.5rem .8rem;cursor:pointer}
#log{background:#18181b;color:#e4e4e7;padding:1rem;border-radius:8px;height:340px;overflow:auto;font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap}
</style></head><body>
<h1>NIP-46 test client <small>(website side)</small></h1>
<p>Zappi → Settings → 지갑 → <b>웹로그인 &amp; 원격 서명</b> → <b>붙혀넣기</b> 로 아래 URI를 붙여넣으세요.</p>
<p><code id="uri"></code> <button onclick="navigator.clipboard.writeText(document.getElementById('uri').textContent)">복사</button></p>
<p><img id="img" width="64" height="64" style="border-radius:14px;vertical-align:middle"> <span>← client image (URI <code>image</code>)</span></p>
<p>status <b id="status"></b> · signer <code id="signer"></code> · user <code id="user"></code></p>
<div>
<button onclick="req('ping')">ping</button>
<button onclick="req('get_public_key')">get_public_key</button>
<button onclick="req('sign_event:22242')">sign_event 22242</button>
<button onclick="req('sign_event:1')">sign_event 1 (승인 테스트)</button>
<button onclick="req('logout')">logout</button>
</div>
<h3>log</h3><pre id="log"></pre>
<script>
async function req(method){
  const r = await fetch('/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method})});
  if(!r.ok) alert(await r.text());
}
async function tick(){
  try{
    const s = await (await fetch('/state')).json();
    document.getElementById('uri').textContent = s.uri;
    document.getElementById('img').src = s.image;
    document.getElementById('status').textContent = s.connected ? 'connected' : 'waiting for Zappi…';
    document.getElementById('signer').textContent = s.signerPubkey || '-';
    document.getElementById('user').textContent = s.userPubkey || '-';
    const log = document.getElementById('log');
    log.textContent = s.log.join('\\n');
    log.scrollTop = log.scrollHeight;
  }catch{}
}
setInterval(tick,1000); tick();
</script></body></html>`

const readBody = (req) =>
  new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => resolve(body))
  })

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(PAGE)
  }
  if (req.method === 'GET' && req.url === '/state') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ...state, uri, image: IMAGE }))
  }
  if (req.method === 'POST' && req.url === '/request') {
    const { method } = JSON.parse((await readBody(req)) || '{}')
    try {
      await handleRequest(method)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
    } catch (e) {
      pushLog(`! ${method}: ${e.message}`)
      res.writeHead(400, { 'content-type': 'text/plain' })
      res.end(e.message)
    }
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(PORT, () => {
  start()
  console.log('\n────────────────────────────────────────────────────────')
  console.log('NIP-46 test client ready')
  console.log('  control page: http://localhost:' + PORT)
  console.log('  client pubkey:', clientPub)
  console.log('  relays:', RELAYS.join(', '))
  console.log('\n  nostrconnect URI (paste into Zappi):\n')
  console.log('  ' + uri + '\n')
  console.log('────────────────────────────────────────────────────────\n')
})

const shutdown = () => {
  sub?.close()
  pool.close(RELAYS)
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
