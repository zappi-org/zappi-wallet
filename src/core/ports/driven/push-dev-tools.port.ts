/**
 * PushDevTools — dev-only push diagnostics.
 *
 * Never part of the wallet domain: the composition root populates this only
 * when `import.meta.env.DEV`, and the settings UI shows it behind the same gate.
 * It exists so a developer can exercise the whole wake-up chain locally:
 * register -> publish a self gift-wrap (kind:1059) -> server poll -> OS push.
 */

export interface PushDevTools {
  /** The `#p` value senders must target for this device. */
  inboxPub(): string

  /** Register with the given inbox relays (NIP-98 + Web Push). Empty = server default. */
  register(relayUrls: string[]): Promise<boolean>

  /** Unregister locally + server-side. */
  unregister(): Promise<void>

  /** Publish a kind:1059 event tagged to this device's inbox, to the relays. */
  publishSelfGiftWrap(relayUrls: string[]): Promise<void>
}
