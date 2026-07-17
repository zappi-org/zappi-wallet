import type { PaymentAliasProvider } from '@/core/ports/driven/payment-alias-provider.port'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'

export type SignerFactory = (privkey: string) => NostrSigner

export function createClaimStoragePoller(deps: {
  provider: PaymentAliasProvider
  createSigner: SignerFactory
  getPrivkey: () => string | null
  redeemToken: (token: string) => Promise<void>
  pollIntervalMs?: number
}) {
  const {
    provider,
    createSigner,
    getPrivkey,
    redeemToken,
    pollIntervalMs = 60_000,
  } = deps

  let timer: ReturnType<typeof setInterval> | null = null
  let running = false

  const poll = async () => {
    const privkey = getPrivkey()
    if (!privkey) {
      console.log('[ClaimStoragePoller] poll skipped — no privkey')
      return
    }

    try {
      const signer = createSigner(privkey)
      const session = await provider.authenticate(signer)
      if (!session.ok) {
        console.log('[ClaimStoragePoller] poll skipped — auth failed')
        return
      }

      const balance = await provider.getBalance(session.value)
      if (!balance.ok) {
        console.log('[ClaimStoragePoller] getBalance failed:', balance.error.message)
        return
      }

      if (balance.value <= 0) return

      console.log('[ClaimStoragePoller] balance detected:', balance.value)

      const claim = await provider.getClaim(session.value)
      if (!claim.ok) {
        console.log('[ClaimStoragePoller] getClaim failed:', claim.error.message)
        return
      }

      for (const { token } of claim.value.tokens) {
        try {
          await redeemToken(token)
        } catch (err) {
          console.warn('[ClaimStoragePoller] redeemToken failed:', err)
        }
      }
    } catch (err) {
      console.warn('[ClaimStoragePoller] poll error:', err)
    }
  }

  const start = () => {
    if (running) return
    running = true
    console.log('[ClaimStoragePoller] start — polling every', pollIntervalMs, 'ms')
    poll().catch(() => {})
    timer = setInterval(() => poll().catch(() => {}), pollIntervalMs)
  }

  const stop = () => {
    running = false
    if (timer !== null) {
      clearInterval(timer)
      timer = null
      console.log('[ClaimStoragePoller] stop')
    }
  }

  return { start, stop }
}
