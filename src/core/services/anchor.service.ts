/**
 * AnchorService — AnchorUseCase 구현 (ZAP-159)
 *
 * NostrGateway + AnchorStore 포트를 조합.
 * 앱 시작 시 local/remote anchor 비교하여 recovery mode 판별.
 */

import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { AnchorStore, AnchorData } from '@/core/ports/driven/anchor.port'
import type { AnchorUseCase, AnchorCheckResult } from '@/core/ports/driving/anchor.usecase'

// Anchor validity period (2 days in seconds)
const ANCHOR_VALIDITY_SECONDS = 2 * 24 * 60 * 60

const ANCHOR_MESSAGE_TYPE = 'zappi-anchor'
const ANCHOR_VERSION = 1

interface AnchorMessage {
  type: typeof ANCHOR_MESSAGE_TYPE
  v: typeof ANCHOR_VERSION
  timestamp: number
}

function isAnchorValid(timestamp: number): boolean {
  const now = Date.now()
  const anchorTime = timestamp * 1000
  return (now - anchorTime) < ANCHOR_VALIDITY_SECONDS * 1000
}

export class AnchorService implements AnchorUseCase {
  constructor(
    private readonly nostr: NostrGateway,
    private readonly anchorStore: AnchorStore,
  ) {}

  async check(params: {
    privateKey: string
    publicKey: string
    relays: string[]
  }): Promise<AnchorCheckResult> {
    // Case A: Local anchor exists
    const localAnchor = this.anchorStore.getCachedAnchor()

    if (localAnchor) {
      if (!navigator.onLine) {
        return { anchor: localAnchor, isRecoveryMode: false }
      }

      if (!isAnchorValid(localAnchor.timestamp)) {
        const newAnchor = await this.publishAnchor(params)
        return {
          anchor: newAnchor || localAnchor,
          isRecoveryMode: false,
        }
      }

      return { anchor: localAnchor, isRecoveryMode: false }
    }

    // Offline and no local anchor
    if (!navigator.onLine) {
      return { anchor: null, isRecoveryMode: false }
    }

    // Case B: No local anchor → fetch from relays (recovery/reinstall)
    const remoteAnchors = await this.fetchAnchors(params)

    if (remoteAnchors.length > 0) {
      const oldestAnchor = remoteAnchors[0]
      const newestAnchor = remoteAnchors[remoteAnchors.length - 1]

      if (!isAnchorValid(newestAnchor.timestamp)) {
        const newAnchor = await this.publishAnchor(params)
        return {
          anchor: newAnchor || newestAnchor,
          isRecoveryMode: true,
          oldestAnchor,
        }
      }

      this.anchorStore.setCachedAnchor(newestAnchor)
      return {
        anchor: newestAnchor,
        isRecoveryMode: true,
        oldestAnchor,
      }
    }

    // Case C: No anchors found → new user
    const newAnchor = await this.publishAnchor(params)
    return { anchor: newAnchor, isRecoveryMode: false }
  }

  // ─── Private helpers ───

  private async publishAnchor(params: {
    publicKey: string
    relays: string[]
  }): Promise<AnchorData | null> {
    try {
      const now = Math.floor(Date.now() / 1000)
      const message: AnchorMessage = {
        type: ANCHOR_MESSAGE_TYPE,
        v: ANCHOR_VERSION,
        timestamp: now,
      }

      const event = await this.nostr.sendGiftWrap({
        recipientPubkey: params.publicKey,
        content: JSON.stringify(message),
        relays: params.relays,
      })

      const anchor: AnchorData = {
        timestamp: now,
        eventId: event.id,
        cachedAt: Date.now(),
      }

      this.anchorStore.setCachedAnchor(anchor)
      return anchor
    } catch (error) {
      console.error('[AnchorService] Failed to publish:', error)
      return null
    }
  }

  private async fetchAnchors(params: {
    publicKey: string
    relays: string[]
  }): Promise<AnchorData[]> {
    try {
      const messages = await this.nostr.fetchGiftWraps({
        recipientPubkey: params.publicKey,
        relays: params.relays,
      })

      const anchors: AnchorData[] = []
      for (const msg of messages) {
        try {
          const content = JSON.parse(msg.content)
          if (content.type === ANCHOR_MESSAGE_TYPE && content.v === ANCHOR_VERSION) {
            anchors.push({
              timestamp: content.timestamp,
              eventId: msg.eventId,
              cachedAt: Date.now(),
            })
          }
        } catch {
          // Not valid JSON or not an anchor
        }
      }

      anchors.sort((a, b) => a.timestamp - b.timestamp)
      return anchors
    } catch (error) {
      console.error('[AnchorService] Failed to fetch:', error)
      return []
    }
  }
}
