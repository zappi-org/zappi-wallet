/**
 * PushDevToolsAdapter — dev-only diagnostics for the wake-up chain.
 *
 * - `inboxPub()`: the `#p` value senders must target (the real npub).
 * - `register()/unregister()`: delegate to the real gateway (so permission,
 *   NIP-98 and the server contract are exercised exactly as production).
 * - `publishSelfGiftWrap()`: signs a bare kind:1059 event with a throwaway key
 *   and tags it to this inbox — enough for the server to trigger a real push.
 *
 * Dev-gated at the composition root; never constructed in production.
 */

import { finalizeEvent, generateSecretKey, getPublicKey, SimplePool } from 'nostr-tools'
import type { Event } from 'nostr-tools'
import type { PushNotificationGateway } from '@/core/ports/driven/push-notification.port'
import type { PushDevTools } from '@/core/ports/driven/push-dev-tools.port'

export interface PushDevToolsDeps {
  /** Wallet nostr secret key — the audit value is its real npub. */
  identitySecretKey: Uint8Array
  gateway: PushNotificationGateway
  /** Injectable seam (tests). */
  publish?: (relayUrls: string[], event: Event) => Promise<void>
}

async function publishToRelays(relayUrls: string[], event: Event): Promise<void> {
  const pool = new SimplePool()
  try {
    await Promise.all(pool.publish(relayUrls, event))
  } finally {
    pool.close(relayUrls)
    pool.destroy()
  }
}

export class PushDevToolsAdapter implements PushDevTools {
  private readonly identitySecretKey: Uint8Array
  private readonly gateway: PushNotificationGateway
  private readonly publish: (relayUrls: string[], event: Event) => Promise<void>

  constructor(deps: PushDevToolsDeps) {
    this.identitySecretKey = deps.identitySecretKey
    this.gateway = deps.gateway
    this.publish = deps.publish ?? publishToRelays
  }

  inboxPub(): string {
    return getPublicKey(this.identitySecretKey)
  }

  register(relayUrls: string[]): Promise<boolean> {
    return this.gateway.enable(relayUrls)
  }

  unregister(): Promise<void> {
    return this.gateway.disable()
  }

  async publishSelfGiftWrap(relayUrls: string[]): Promise<void> {
    const event = finalizeEvent(
      {
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', this.inboxPub()]],
        content: '',
      },
      generateSecretKey(),
    )
    await this.publish(relayUrls, event)
  }
}
