import { ChatAddressError, ChatCapacityError } from '@/core/errors/chat'
import { conversationId, MAX_CHAT_MESSAGE_BYTES } from '@/core/domain/chat'
import { withChatTimeout } from './internal/chat-delivery'
import { parseGiftWrapTokenContent } from '@/core/domain/gift-wrap-token'
import type { ChatMessage } from '@/core/domain/chat'
import type { ChatTransport } from '@/core/ports/driven/chat-transport.port'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { UnsignedNostrEvent } from '@/core/domain/nostr'
import {
  derivePublicKey,
  normalizePubkey,
  extractRelaysFromNprofile,
  rumorId,
  unwrapChatRumor,
  verifyEventSignature,
} from './internal/nostr-crypto'

export class NostrChatTransport implements ChatTransport {
  readonly channel = 'direct'
  readonly capabilities = {
    contacts: true,
    payments: true,
    deletion: true,
    blocking: true,
  }
  readonly account: string
  readonly identity: string
  private destroyed = false
  private subscriptions = new Set<() => void>()
  private handled = new Set<string>()
  private hints = new Map<string, string[]>()
  private inboxes = new Map<string, { createdAt: number; relays: string[] }>()
  constructor(
    private gateway: NostrGateway,
    private privateKey: string,
    private relays: () => string[]
  ) {
    this.identity = derivePublicKey(privateKey)
    this.account = this.identity
  }
  resolvePeer(address: string): string {
    this.assertUsable()
    const input = address.trim().replace(/^nostr:/i, '')
    const peer = normalizePubkey(input)
    if (!peer) throw new ChatAddressError('invalid')
    const hints = extractRelaysFromNprofile(input)
      .filter((url) => /^wss:\/\//.test(url))
      .slice(0, 8)
    if (hints.length) this.hints.set(peer, hints)
    return peer
  }
  private rumor(m: ChatMessage): UnsignedNostrEvent {
    return {
      pubkey: m.sender,
      kind: 14,
      content: m.content,
      created_at: Math.floor(m.createdAt / 1000),
      tags: [
        ['p', m.recipient],
        ...(m.nonce ? [['client', 'zappi', m.nonce]] : []),
        ...(m.expiresAt === undefined ? [] : [['zappi-request-expiration', String(m.expiresAt / 1000)]]),
      ],
    }
  }
  prepare(peer: string, content: string, options?: { expiresAt: number }): ChatMessage {
    this.assertUsable()
    const expiresAt = options === undefined ? undefined : Math.floor(options.expiresAt / 1000) * 1000
    if (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()))
      throw new Error('Invalid chat request expiry')
    const message: ChatMessage = {
      id: '',
      conversationId: conversationId(this, peer),
      sender: this.identity,
      recipient: peer,
      content,
      createdAt: Date.now(),
      outgoing: true,
      status: 'sending',
      nonce: crypto.randomUUID(),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    }
    return { ...message, id: rumorId(this.rumor(message)) }
  }
  async send(message: ChatMessage) {
    this.assertUsable()
    if (
      message.sender !== this.identity ||
      message.conversationId !== conversationId(this, message.recipient)
    )
      throw new Error('Chat message identity mismatch')
    if (message.expiresAt !== undefined && (!Number.isSafeInteger(message.expiresAt) || message.expiresAt % 1000 !== 0 || message.expiresAt <= Date.now()))
      throw new Error('Chat request expired')
    const rumor = this.rumor(message)
    if (message.id !== rumorId(rumor))
      throw new Error('Chat message integrity mismatch')
    const events = await withChatTimeout(
      this.gateway.queryEvents([
        { kinds: [10050], authors: [message.recipient], limit: 1 },
      ]),
      3000
    ).catch(() => [])
    this.assertUsable()
    const directory = events
      .filter((event) => {
        try {
          return (
            event.kind === 10050 &&
            event.pubkey === message.recipient &&
            Number.isSafeInteger(event.created_at) &&
            event.created_at >= 0 &&
            event.created_at <= Date.now() / 1000 + 60 &&
            verifyEventSignature(event)
          )
        } catch {
          return false
        }
      })
      .sort((a, b) => b.created_at - a.created_at)[0]
    const cached = this.inboxes.get(message.recipient)
    if (directory && (!cached || directory.created_at >= cached.createdAt)) {
      this.inboxes.set(message.recipient, {
        createdAt: directory.created_at,
        relays: directory.tags
          .filter((tag) => tag[0] === 'relay' && /^wss:\/\//.test(tag[1]))
          .map((tag) => tag[1])
          .slice(0, 8),
      })
    }
    const inbox = this.inboxes.get(message.recipient)
    const relays = inbox
      ? inbox.relays
      : this.hints.get(message.recipient) ?? []
    if (!relays.length) throw new Error('Recipient chat relays unavailable')
    const publish = async (recipientPubkey: string, targets: string[]) => {
      this.assertUsable()
      if (message.expiresAt !== undefined && message.expiresAt <= Date.now())
        throw new Error('Chat request expired')
      if (targets.length === 0) throw new Error('No chat relays available')
      await Promise.any(
        [...new Set(targets)].slice(0, 8).map((relay) =>
          withChatTimeout(
            this.gateway.sendGiftWrap({
              recipientPubkey,
              content: message.content,
              relays: [relay],
              rumor,
              timeoutMs: 8000,
            }),
            12000
          )
        )
      )
    }
    await publish(message.recipient, relays)
    // Sender backup must not block recipient delivery or the next message.
    if (!this.destroyed)
      void publish(this.identity, this.relays()).catch(() => undefined)
  }
  subscribe(
    handler: (message: ChatMessage) => Promise<void>,
    onError: (error: unknown) => void = () => {}
  ) {
    this.assertUsable()
    let closed = false
    let queue = Promise.resolve()
    const pending = new Set<string>()
    let overflowReported = false
    const stop = this.gateway.subscribe(
      [{ kinds: [1059], '#p': [this.identity] }],
      (event) => {
        if (
          closed ||
          event.kind !== 1059 ||
          typeof event.content !== 'string' ||
          event.content.length > 100000 ||
          !Array.isArray(event.tags)
        )
          return
        const destinations = event.tags.filter(
          (tag) => Array.isArray(tag) && tag[0] === 'p'
        )
        if (
          destinations.length !== 1 ||
          destinations[0][1] !== this.identity ||
          this.handled.has(event.id) ||
          pending.has(event.id)
        )
          return
        if (pending.size >= 512) {
          if (!overflowReported) {
            overflowReported = true
            onError(new ChatCapacityError('receive'))
          }
          return
        }
        pending.add(event.id)
        queue = queue
          .then(async () => {
            if (closed) return
            try {
              if (!verifyEventSignature(event)) return
              const r = unwrapChatRumor(event, this.privateKey)
              if (
                r.kind !== 14 ||
                typeof r.content !== 'string' ||
                !r.content.trim() ||
                new TextEncoder().encode(r.content).length >
                  MAX_CHAT_MESSAGE_BYTES
              )
                return
              if (
                !Number.isSafeInteger(r.created_at) ||
                r.created_at < 0 ||
                r.created_at > Date.now() / 1000 + 60
              )
                return
              if (r.id !== rumorId(r) || !/^[a-f0-9]{64}$/.test(r.pubkey))
                return
              if (r.tags.some((tag) => tag[0] === 'ticket_id')) return
              const recipients = r.tags
                .filter((t) => t[0] === 'p')
                .map((t) => t[1])
              if (recipients.length !== 1) return
              const outgoing = r.pubkey === this.identity
              if (!outgoing && recipients[0] !== this.identity) return
              const peer = outgoing ? recipients[0] : r.pubkey
              if (!/^[a-f0-9]{64}$/.test(peer) || peer === this.identity) return
              // Payment envelopes belong to the wallet's existing incoming watcher.
              if (parseGiftWrapTokenContent(r.content, r.id)) return
              const expiryTags = r.tags.filter((tag) => tag[0] === 'zappi-request-expiration')
              if (expiryTags.length > 1 || expiryTags.some((tag) => tag.length !== 2)) return
              const expiryValue = expiryTags[0]?.[1]
              const expiresAt = expiryValue === undefined ? undefined : Number(expiryValue) * 1000
              if (expiryTags.length && (expiryValue === undefined || !/^\d+$/.test(expiryValue) || !Number.isSafeInteger(expiresAt) || expiresAt! <= 0)) return
              const message: ChatMessage = {
                id: r.id,
                conversationId: conversationId(this, peer),
                sender: r.pubkey,
                recipient: recipients[0],
                content: r.content,
                createdAt: r.created_at * 1000,
                ...(expiresAt === undefined ? {} : { expiresAt }),
                outgoing,
                status: outgoing ? 'sent' : 'received',
              }
              if (closed) return
              try {
                await handler(message)
                this.handled.add(event.id)
                if (this.handled.size > 4096)
                  this.handled.delete(this.handled.values().next().value!)
              } catch (error) {
                onError(error)
              }
            } catch {
              /* Invalid or undecryptable messages are ignored. */
            }
          })
          .finally(() => {
            pending.delete(event.id)
          })
      }
    )
    const cleanup = () => {
      closed = true
      stop()
      this.subscriptions.delete(cleanup)
    }
    this.subscriptions.add(cleanup)
    return cleanup
  }
  destroy(): void {
    this.destroyed = true
    this.privateKey = ''
    for (const stop of this.subscriptions) stop()
    this.handled.clear()
    this.hints.clear()
    this.inboxes.clear()
  }
  private assertUsable(): void {
    if (this.destroyed) throw new Error('Chat identity is locked')
  }
}
