import { finalizeEvent, type NostrEvent, type Filter } from 'nostr-tools'
import { SimplePool } from 'nostr-tools/pool'
import { type Subscription } from 'nostr-tools/abstract-relay'
import { hexToBytes } from '@noble/hashes/utils.js'
import { ok, err, type Result } from '@/core/types'
import { EventPublishError, type BaseError } from '@/core/errors'
import { NOSTR_KINDS, TIMEOUTS, RETRY, CASHU_UNIT } from '@/core/constants'

/**
 * Signed Nostr event
 */
export type SignedEvent = NostrEvent

/**
 * NutZap info parsed from kind 10019
 */
export interface NutZapInfo {
  mints: string[]
  p2pkPubkey?: string
  relays?: string[]
}

/**
 * Subscription with auto-reconnect
 */
export interface ManagedSubscription {
  id: string
  relays: string[]
  filter: Filter
  onEvent: (event: SignedEvent) => void
  onEose?: () => void
  onReconnect?: () => void
  unsubscribe: () => void
}

/**
 * Reconnection state for a subscription
 */
interface ReconnectState {
  attempts: number
  lastAttempt: number
  timeoutId: ReturnType<typeof setTimeout> | null
  isActive: boolean
}

/**
 * Individual relay subscription info
 */
interface RelaySubscription {
  relayUrl: string
  subscription: Subscription
}

/**
 * Service for Nostr relay operations with auto-reconnect
 * Uses pool.ensureRelay() for standard-compliant REQ message formatting
 */
export class NostrService {
  private pool: SimplePool
  private subscriptions: Map<string, ManagedSubscription> = new Map()
  private reconnectStates: Map<string, ReconnectState> = new Map()
  private relaySubscriptions: Map<string, RelaySubscription[]> = new Map()

  constructor() {
    this.pool = new SimplePool()
  }

  /**
   * Create and sign a Nostr event
   */
  createEvent(
    privateKeyHex: string,
    kind: number,
    content: string,
    tags: string[][]
  ): SignedEvent {
    const privateKey = hexToBytes(privateKeyHex)

    const unsignedEvent = {
      kind,
      content,
      tags,
      created_at: Math.floor(Date.now() / 1000),
    }

    return finalizeEvent(unsignedEvent, privateKey)
  }

  /**
   * Create kind 10019 (NutZap Info) event
   */
  createKind10019Event(
    privateKeyHex: string,
    mints: string[],
    p2pkPubkey: string,
    relays?: string[]
  ): SignedEvent {
    const tags: string[][] = []

    // Add mint tags (with unit per NIP-61)
    for (const mint of mints) {
      tags.push(['mint', mint, CASHU_UNIT])
    }

    // Add P2PK pubkey
    tags.push(['pubkey', p2pkPubkey])

    // Add relay tags if provided
    if (relays) {
      for (const relay of relays) {
        tags.push(['relay', relay])
      }
    }

    return this.createEvent(
      privateKeyHex,
      NOSTR_KINDS.NUTZAP_INFO,
      '',
      tags
    )
  }

  /**
   * Create kind 10002 (Relay List) event
   */
  createKind10002Event(
    privateKeyHex: string,
    relays: string[]
  ): SignedEvent {
    const tags = relays.map((relay) => ['r', relay])

    return this.createEvent(
      privateKeyHex,
      NOSTR_KINDS.RELAY_LIST,
      '',
      tags
    )
  }

  /**
   * Create kind 10050 (DM Relay List) event for NIP-17
   * This tells other clients where to send encrypted DMs
   */
  createKind10050Event(
    privateKeyHex: string,
    relays: string[]
  ): SignedEvent {
    const tags = relays.map((relay) => ['relay', relay])

    return this.createEvent(
      privateKeyHex,
      NOSTR_KINDS.DM_RELAY_LIST,
      '',
      tags
    )
  }

  /**
   * Publish an event to relays
   */
  async publish(
    event: SignedEvent,
    relays: string[]
  ): Promise<Result<string[], BaseError>> {
    try {
      const results = await Promise.allSettled(
        this.pool.publish(relays, event)
      )

      const succeeded: string[] = []
      const failed: string[] = []

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          succeeded.push(relays[index])
        } else {
          failed.push(relays[index])
        }
      })

      if (succeeded.length === 0) {
        return err(new EventPublishError(event.kind, failed))
      }

      return ok(succeeded)
    } catch (error) {
      return err(new EventPublishError(event.kind, relays, error))
    }
  }

  /**
   * Query events from relays
   */
  async queryEvents(
    relays: string[],
    filter: Filter,
    timeout: number = TIMEOUTS.RELAY_CONNECTION
  ): Promise<SignedEvent[]> {
    try {
      const events = await this.pool.querySync(relays, filter, {
        maxWait: timeout,
      })
      return events
    } catch {
      return []
    }
  }

  /**
   * Query a single event by filter
   */
  async queryEvent(
    relays: string[],
    filter: Filter
  ): Promise<SignedEvent | null> {
    const events = await this.queryEvents(relays, { ...filter, limit: 1 })
    return events[0] ?? null
  }

  /**
   * Subscribe to events using ensureRelay for standard-compliant REQ messages
   * Returns cleanup function
   */
  subscribe(
    relays: string[],
    filter: Filter,
    onEvent: (event: SignedEvent) => void,
    onEose?: () => void
  ): () => void {
    const subscriptions: Subscription[] = []
    let eoseCount = 0
    const totalRelays = relays.length

    // Subscribe to each relay individually
    for (const relayUrl of relays) {
      this.pool.ensureRelay(relayUrl).then((relay) => {
        const sub = relay.subscribe([filter], {
          onevent: onEvent,
          oneose: () => {
            eoseCount++
            // Call onEose when all relays have sent EOSE
            if (eoseCount >= totalRelays && onEose) {
              onEose()
            }
          },
        })
        subscriptions.push(sub)
      }).catch((error) => {
        console.warn(`[NostrService] Failed to connect to ${relayUrl}:`, error)
      })
    }

    return () => {
      for (const sub of subscriptions) {
        sub.close()
      }
    }
  }

  /**
   * Subscribe with automatic reconnection on failure
   * Uses ensureRelay for standard-compliant REQ messages
   * Uses exponential backoff for reconnection attempts
   */
  subscribeWithReconnect(
    relays: string[],
    filter: Filter,
    onEvent: (event: SignedEvent) => void,
    options?: {
      onEose?: () => void
      onReconnect?: () => void
      onDisconnect?: () => void
    }
  ): ManagedSubscription {
    const subscriptionId = `sub-${crypto.randomUUID()}`

    // Initialize reconnect state
    this.reconnectStates.set(subscriptionId, {
      attempts: 0,
      lastAttempt: 0,
      timeoutId: null,
      isActive: true,
    })

    // Initialize relay subscriptions array
    this.relaySubscriptions.set(subscriptionId, [])

    // Create subscription for a single relay
    const subscribeToRelay = async (relayUrl: string) => {
      const state = this.reconnectStates.get(subscriptionId)
      if (!state?.isActive) return

      try {
        const relay = await this.pool.ensureRelay(relayUrl)
        const sub = relay.subscribe([filter], {
          onevent: onEvent,
          oneose: () => {
            // Reset attempts on successful connection
            const currentState = this.reconnectStates.get(subscriptionId)
            if (currentState) {
              currentState.attempts = 0
            }
          },
          onclose: (reason) => {
            // Handle disconnection - attempt reconnect for this relay
            const currentState = this.reconnectStates.get(subscriptionId)
            if (currentState?.isActive) {
              console.log(`[NostrService] Relay ${relayUrl} closed: ${reason}`)
              options?.onDisconnect?.()
              this.scheduleRelayReconnect(subscriptionId, relayUrl, filter, onEvent, options?.onReconnect)
            }
          },
        })

        // Store the subscription
        const relaySubs = this.relaySubscriptions.get(subscriptionId) || []
        relaySubs.push({ relayUrl, subscription: sub })
        this.relaySubscriptions.set(subscriptionId, relaySubs)
      } catch (error) {
        // Connection failed, schedule reconnect for this relay
        console.warn(`[NostrService] Failed to connect to ${relayUrl}:`, error)
        const currentState = this.reconnectStates.get(subscriptionId)
        if (currentState?.isActive) {
          this.scheduleRelayReconnect(subscriptionId, relayUrl, filter, onEvent, options?.onReconnect)
        }
      }
    }

    // Start initial subscriptions for all relays
    for (const relayUrl of relays) {
      subscribeToRelay(relayUrl)
    }

    // Call onEose after a short delay (since we're connecting to multiple relays)
    setTimeout(() => {
      options?.onEose?.()
    }, TIMEOUTS.RELAY_CONNECTION)

    // Create managed subscription object
    const managedSub: ManagedSubscription = {
      id: subscriptionId,
      relays,
      filter,
      onEvent,
      onEose: options?.onEose,
      onReconnect: options?.onReconnect,
      unsubscribe: () => {
        this.unsubscribeManagedSubscription(subscriptionId)
      },
    }

    this.subscriptions.set(subscriptionId, managedSub)
    return managedSub
  }

  /**
   * Schedule a reconnection attempt for a single relay with exponential backoff
   */
  private scheduleRelayReconnect(
    subscriptionId: string,
    relayUrl: string,
    filter: Filter,
    onEvent: (event: SignedEvent) => void,
    onReconnect?: () => void
  ): void {
    const state = this.reconnectStates.get(subscriptionId)
    if (!state || !state.isActive) return

    // Check max attempts
    if (state.attempts >= RETRY.MAX_ATTEMPTS) {
      console.warn(`[NostrService] Max reconnect attempts reached for ${relayUrl}`)
      return
    }

    // Calculate delay with exponential backoff
    const delay = Math.min(
      RETRY.INITIAL_DELAY * Math.pow(RETRY.BACKOFF_MULTIPLIER, state.attempts),
      RETRY.MAX_DELAY
    )

    state.attempts++
    state.lastAttempt = Date.now()

    // Schedule reconnect
    setTimeout(async () => {
      const currentState = this.reconnectStates.get(subscriptionId)
      if (!currentState?.isActive) return

      console.log(`[NostrService] Reconnecting to ${relayUrl} (attempt ${currentState.attempts})`)
      onReconnect?.()

      try {
        const relay = await this.pool.ensureRelay(relayUrl)
        const sub = relay.subscribe([filter], {
          onevent: onEvent,
          oneose: () => {
            currentState.attempts = 0
          },
          onclose: (reason) => {
            if (currentState?.isActive) {
              console.log(`[NostrService] Relay ${relayUrl} closed after reconnect: ${reason}`)
              this.scheduleRelayReconnect(subscriptionId, relayUrl, filter, onEvent, onReconnect)
            }
          },
        })

        // Update stored subscription
        const relaySubs = this.relaySubscriptions.get(subscriptionId) || []
        const existingIdx = relaySubs.findIndex(rs => rs.relayUrl === relayUrl)
        if (existingIdx >= 0) {
          relaySubs[existingIdx] = { relayUrl, subscription: sub }
        } else {
          relaySubs.push({ relayUrl, subscription: sub })
        }
        this.relaySubscriptions.set(subscriptionId, relaySubs)
      } catch (error) {
        console.warn(`[NostrService] Reconnect failed for ${relayUrl}:`, error)
        this.scheduleRelayReconnect(subscriptionId, relayUrl, filter, onEvent, onReconnect)
      }
    }, delay)
  }

  /**
   * Unsubscribe a managed subscription
   */
  private unsubscribeManagedSubscription(subscriptionId: string): void {
    // Mark as inactive
    const state = this.reconnectStates.get(subscriptionId)
    if (state) {
      state.isActive = false
      if (state.timeoutId) {
        clearTimeout(state.timeoutId)
      }
    }

    // Close all relay subscriptions
    const relaySubs = this.relaySubscriptions.get(subscriptionId)
    if (relaySubs) {
      for (const { subscription } of relaySubs) {
        subscription.close()
      }
    }

    // Clean up maps
    this.subscriptions.delete(subscriptionId)
    this.reconnectStates.delete(subscriptionId)
    this.relaySubscriptions.delete(subscriptionId)
  }

  /**
   * Get all active managed subscriptions
   */
  getActiveSubscriptions(): ManagedSubscription[] {
    return Array.from(this.subscriptions.values())
  }

  /**
   * Reconnect all managed subscriptions (e.g., after coming back online)
   */
  reconnectAll(): void {
    for (const [id, sub] of this.subscriptions) {
      const state = this.reconnectStates.get(id)
      if (state) {
        // Reset attempts
        state.attempts = 0
        if (state.timeoutId) {
          clearTimeout(state.timeoutId)
        }

        // Close existing subscriptions
        const relaySubs = this.relaySubscriptions.get(id)
        if (relaySubs) {
          for (const { subscription } of relaySubs) {
            subscription.close()
          }
        }
        this.relaySubscriptions.set(id, [])

        // Recreate subscriptions for each relay
        for (const relayUrl of sub.relays) {
          this.pool.ensureRelay(relayUrl).then((relay) => {
            const newSub = relay.subscribe([sub.filter], {
              onevent: sub.onEvent,
              oneose: sub.onEose,
            })
            const currentRelaySubs = this.relaySubscriptions.get(id) || []
            currentRelaySubs.push({ relayUrl, subscription: newSub })
            this.relaySubscriptions.set(id, currentRelaySubs)
          }).catch((error) => {
            console.warn(`[NostrService] Failed to reconnect to ${relayUrl}:`, error)
          })
        }

        sub.onReconnect?.()
      }
    }
  }

  /**
   * Parse kind 10019 (NutZap Info) event
   */
  parseNutZapInfo(event: SignedEvent): NutZapInfo {
    const mints: string[] = []
    let p2pkPubkey: string | undefined
    const relays: string[] = []

    for (const tag of event.tags) {
      if (tag[0] === 'mint' && tag[1] && (tag.length === 2 || tag.slice(2).includes(CASHU_UNIT))) {
        mints.push(tag[1])
      } else if (tag[0] === 'pubkey' && tag[1]) {
        p2pkPubkey = tag[1]
      } else if (tag[0] === 'relay' && tag[1]) {
        relays.push(tag[1])
      }
    }

    return { mints, p2pkPubkey, relays: relays.length > 0 ? relays : undefined }
  }

  /**
   * Parse kind 10002 (Relay List) event
   */
  parseRelayList(event: SignedEvent): string[] {
    const relays: string[] = []

    for (const tag of event.tags) {
      if (tag[0] === 'r' && tag[1]) {
        relays.push(tag[1])
      }
    }

    return relays
  }

  /**
   * Close all relay connections and subscriptions
   */
  close(): void {
    // Unsubscribe all managed subscriptions
    for (const id of this.subscriptions.keys()) {
      this.unsubscribeManagedSubscription(id)
    }

    // Close pool
    this.pool.close([])
  }
}
