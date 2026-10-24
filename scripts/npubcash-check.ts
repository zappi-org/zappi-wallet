#!/usr/bin/env bun
/**
 * npubcash local checks — exercises the exact path the app uses, without the UI:
 *
 *   mint testnut ecash → send a V4 (short keyset id) token to the server →
 *   NIP-98 login → POST /api/v2/user/username → assert the alias landed.
 *
 * Usage (from the app repo):
 *   bun scripts/npubcash-check.ts            # full check against $NPUBCASH_URL
 *   bun scripts/npubcash-check.ts --offline  # fork's redeem path, no server/port needed
 *   bun scripts/npubcash-check.ts --fund 250 # print a token to paste into the app
 *
 * Env: NPUBCASH_URL (default http://localhost:8000), MINTURL, USERNAME_COST,
 *      NPUBCASH_PRIVKEY (hex; a throwaway key is generated per run otherwise).
 */
import { Wallet, getEncodedTokenV4, getTokenMetadata } from '@cashu/cashu-ts'
import { finalizeEvent, getPublicKey, nip19 } from 'nostr-tools'
import { randomBytes } from 'node:crypto'

const MINT = process.env.MINTURL ?? 'https://testnut.cashu.space'
const BASE = process.env.NPUBCASH_URL ?? 'http://localhost:8000'
const COST = Number(process.env.USERNAME_COST ?? 100)
// The server binds the JWT to sha256(user-agent) — reuse it on every call.
const UA = 'npubcash-dev-check/1.0'
const PRIVKEY = process.env.NPUBCASH_PRIVKEY ?? randomBytes(32).toString('hex')

const log = (msg: string) => console.log(msg)
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

/** testnut runs a FakeWallet: quotes are paid instantly, so minting is free. */
async function mintToken(amount: number) {
  const wallet = new Wallet(MINT, { unit: 'sat' })
  await wallet.loadMint() // v3 requires an explicit keyset load before minting
  let quote = await wallet.createMintQuoteBolt11(amount)
  // testnut's FakeWallet settles invoices a beat after the quote is created.
  for (let i = 0; i < 20 && quote.state !== 'PAID' && quote.state !== 'ISSUED'; i++) {
    await new Promise((r) => setTimeout(r, 500))
    quote = await wallet.checkMintQuoteBolt11(quote.quote)
  }
  if (quote.state !== 'PAID' && quote.state !== 'ISSUED') fail(`mint quote ${quote.quote} not paid by ${MINT}`)
  const proofs = await wallet.mintProofs(amount, quote)
  const token = getEncodedTokenV4({ mint: MINT, proofs, unit: 'sat' })
  // Round-trip through the same decoder the server uses (cashu-ts v3). A V4 token
  // that fails here would also fail server-side with "invalid token".
  const meta = getTokenMetadata(token)
  return { token, meta, keysetId: proofs[0]?.id ?? '' }
}

function nip98(url: string, method: string, privkeyHex: string): string {
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: [
        ['u', url],
        ['method', method],
      ],
    },
    Uint8Array.from(Buffer.from(privkeyHex, 'hex')),
  )
  return `Nostr ${Buffer.from(JSON.stringify(event)).toString('base64')}`
}

async function login(): Promise<string> {
  const url = `${BASE}/api/v2/auth/nip98`
  const res = await fetch(url, {
    headers: { Authorization: nip98(url, 'GET', PRIVKEY), 'user-agent': UA },
  })
  const body = (await res.json().catch(() => null)) as { data?: { token?: string } } | null
  if (!res.ok || !body?.data?.token) {
    fail(`NIP-98 login failed (HTTP ${res.status}): ${JSON.stringify(body)}`)
  }
  return body.data.token
}

/** Pre-fix control: cashu-ts v3 without loadMint() — the bug `fix/v4-keyset` repairs. */
async function offlineCheck() {
  const serverDir = process.env.NPUBCASH_SERVER_DIR ?? `${process.env.HOME}/doc_off/github.com/npubcash-server`
  const src = `${serverDir}/packages/server/src`
  const { createCashuWalletFactory } = await import(`${src}/domain/communicator/CashuWalletFactory.ts`)
  const { CommunicatorService } = await import(`${src}/domain/communicator/CommunicatorService.ts`)
  const { Wallet, Mint } = await import('@cashu/cashu-ts')
  const executor = {
    run: <T>(_mintUrl: string, _signal: AbortSignal | undefined, request: (s: AbortSignal) => Promise<T>) =>
      request(new AbortController().signal),
  }

  log(`server dir: ${serverDir}`)
  const { token, meta, keysetId } = await mintToken(COST)
  log(`token:      ${meta.amount} sat from ${MINT} (keyset ${keysetId.slice(0, 8)}…, ${keysetId.length} chars)`)

  const legacy = new Wallet(new Mint(MINT, {}))
  const legacyError = await legacy.receive(token).then(() => null, (e: Error) => e.message.split('\n')[0])
  if (!legacyError) fail('pre-fix wallet unexpectedly redeemed the V4 token')
  log(`pre-fix:    rejected → ${legacyError}`)

  const service = new CommunicatorService({
    walletFactory: createCashuWalletFactory({ requestExecutor: executor }),
  })
  const proofs = await service.redeemToken(token)
  const received = proofs.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0)
  log(`fixed:      redeemed ${proofs.length} proofs, ${received} sat (mint input fee ${meta.amount - received} sat)`)
  if (received < meta.amount - 2) fail(`redeemed only ${received} of ${meta.amount} sat`)

  const replay = await service.redeemToken(token).then(() => null, (e: Error) => e.message)
  if (!replay) fail('double spend was accepted')
  log(`replay:     rejected → ${replay.slice(0, 40)}`)
  log('\n✓ fork redeem path OK (decode → loadMint → redeem → single use)')
}

async function main() {
  if (process.argv.includes('--offline')) return offlineCheck()

  const fundIdx = process.argv.indexOf('--fund')
  if (fundIdx > -1) {
    const amount = Number(process.argv[fundIdx + 1] ?? 250)
    const { token, meta, keysetId } = await mintToken(amount)
    log(`mint:      ${MINT}`)
    log(`amount:    ${meta.amount} ${meta.unit}`)
    log(`keyset:    ${keysetId.slice(0, 8)}… (${keysetId.length} chars)`)
    log(`token:     ${token.slice(0, 12)}… (${token.length} chars, decodes as v3-capable)`)
    log(`\n${token}`)
    return
  }

  log(`server:    ${BASE}`)
  const pubkey = getPublicKey(Uint8Array.from(Buffer.from(PRIVKEY, 'hex')))
  log(`identity:  ${nip19.npubEncode(pubkey)}`)

  const { token, meta, keysetId } = await mintToken(COST)
  log(`token:     ${meta.amount} sat from ${MINT} (keyset ${keysetId.slice(0, 8)}…, ${keysetId.length} chars)`)
  // V4 keyset ids are 33 bytes; a short token referencing them only decodes with
  // cashu-ts v3 — exactly the code path `fix/v4-keyset` repairs server-side.
  if (keysetId.length <= 16) log('! mint returned a v1 (16-char) keyset id — v4 path not exercised')

  const jwt = await login()
  log('auth:      200 (NIP-98 → JWT)')

  const username = `t${Date.now().toString(36)}${randomBytes(2).toString('hex')}`.slice(0, 20)
  const res = await fetch(`${BASE}/api/v2/user/username`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${jwt}`,
      'x-cashu': token,
      'user-agent': UA,
    },
    body: JSON.stringify({ username }),
  })
  const body = (await res.json().catch(() => null)) as
    | { data?: { user?: { name?: string } }; message?: string }
    | null

  if (res.status === 402) {
    fail(`still 402 after paying ${COST} sat — check USERNAME_COST / X-Cashu header: ${JSON.stringify(body)}`)
  }
  if (!res.ok) fail(`username purchase failed (HTTP ${res.status}): ${JSON.stringify(body)}`)
  if (body?.data?.user?.name !== username) fail(`unexpected payload: ${JSON.stringify(body)}`)

  log(`purchase:  201 → ${username}@${new URL(BASE).hostname}`)

  const info = await fetch(`${BASE}/api/v2/user/info`, {
    headers: { authorization: `Bearer ${jwt}`, 'user-agent': UA },
  })
  const infoBody = (await info.json().catch(() => null)) as { data?: { user?: { name?: string } } } | null
  if (infoBody?.data?.user?.name !== username) fail(`/user/info mismatch: ${JSON.stringify(infoBody)}`)
  log('info:      alias persisted')

  log('\n✓ v4 token → server decode → redeem → alias OK')
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
