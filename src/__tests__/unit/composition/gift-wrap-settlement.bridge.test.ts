/**
 * GiftWrapSettlementBridge — contract safety net for giftwrap auto-redeem + POS ACK.
 *
 * Pinned contracts:
 * - only incoming nostr-giftwrap on incoming:received is forwarded to processIncomingTransfer
 * - processIncoming failures are swallowed inside the bridge (no unhandled rejection)
 * - transfer:settled: delivery ACK only for a registered POS device's giftwrap, and only when a relay is connected
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createEventBus, type EventBus } from '@/core/events/event-bus'
import { connectGiftWrapSettlementBridge } from '@/composition/gift-wrap-settlement.bridge'
import type { TransferLifecycleService } from '@/core/services/transfer-lifecycle.service'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { POSDevice } from '@/core/types/wallet'

const POS_PUBKEY = 'pos-pubkey-1'

function makeTransfer(over: Record<string, unknown> = {}) {
  return {
    id: 'transfer-1',
    txId: 'tx-1',
    direction: 'incoming',
    transportRef: { type: 'nostr-giftwrap' },
    ...over,
  }
}

async function flushMicrotasks() {
  await new Promise((r) => setTimeout(r, 0))
}

describe('GiftWrapSettlementBridge', () => {
  let eventBus: EventBus
  let processIncomingTransfer: ReturnType<typeof vi.fn>
  let sendPrivateDirectMessage: ReturnType<typeof vi.fn>
  let getRelayStatus: ReturnType<typeof vi.fn>
  let posDevices: POSDevice[] | undefined
  let disconnect: () => void

  beforeEach(() => {
    eventBus = createEventBus()
    processIncomingTransfer = vi.fn().mockResolvedValue(undefined)
    sendPrivateDirectMessage = vi.fn().mockResolvedValue(undefined)
    getRelayStatus = vi.fn().mockReturnValue([
      { url: 'wss://relay-a.example.com', connected: true },
      { url: 'wss://relay-b.example.com', connected: false },
    ])
    posDevices = [{ nostrPublicKey: POS_PUBKEY } as POSDevice]

    disconnect = connectGiftWrapSettlementBridge(
      eventBus,
      { processIncomingTransfer } as unknown as TransferLifecycleService,
      {
        nostrGateway: { getRelayStatus, sendPrivateDirectMessage } as unknown as NostrGateway,
        getPosDevices: () => posDevices,
      },
    )
  })

  afterEach(() => {
    disconnect() // double-call safe — EventBus off is a Set.delete
  })

  // ─── incoming:received → auto redeem ───

  it('nostr-giftwrap incoming → processIncomingTransfer(transfer.id)', async () => {
    eventBus.emit({
      type: 'incoming:received',
      payload: { transfer: makeTransfer() },
    } as Parameters<EventBus['emit']>[0])
    await flushMicrotasks()

    expect(processIncomingTransfer).toHaveBeenCalledWith('transfer-1')
  })

  it('does not process a non-giftwrap transportRef', async () => {
    eventBus.emit({
      type: 'incoming:received',
      payload: { transfer: makeTransfer({ transportRef: { type: 'cashu-token' } }) },
    } as Parameters<EventBus['emit']>[0])
    await flushMicrotasks()

    expect(processIncomingTransfer).not.toHaveBeenCalled()
  })

  it('does not process the outgoing direction', async () => {
    eventBus.emit({
      type: 'incoming:received',
      payload: { transfer: makeTransfer({ direction: 'outgoing' }) },
    } as Parameters<EventBus['emit']>[0])
    await flushMicrotasks()

    expect(processIncomingTransfer).not.toHaveBeenCalled()
  })

  it('processIncoming failure is swallowed with a warn', async () => {
    processIncomingTransfer.mockRejectedValue(new Error('redeem failed'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      eventBus.emit({
        type: 'incoming:received',
        payload: { transfer: makeTransfer() },
      } as Parameters<EventBus['emit']>[0])
      await flushMicrotasks()

      expect(warnSpy).toHaveBeenCalledWith(
        '[GiftWrapSettlementBridge] processIncoming failed for',
        'transfer-1',
        expect.any(Error),
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  // ─── transfer:settled → POS delivery ACK ───

  function emitSettled(over: Record<string, unknown> = {}) {
    eventBus.emit({
      type: 'transfer:settled',
      payload: {
        transfer: makeTransfer({
          transportRef: { type: 'nostr-giftwrap', sender: POS_PUBKEY, txId: 'tx-1' },
          ...over,
        }),
      },
    } as Parameters<EventBus['emit']>[0])
  }

  it('settled giftwrap from a registered POS device → sends delivery_ack only to connected relays', async () => {
    emitSettled()
    await flushMicrotasks()

    expect(sendPrivateDirectMessage).toHaveBeenCalledWith({
      recipientPubkey: POS_PUBKEY,
      content: JSON.stringify({ type: 'delivery_ack', txId: 'tx-1' }),
      relays: ['wss://relay-a.example.com'], // excludes the connected=false relay
    })
  })

  it('unregistered sender → no ACK', async () => {
    emitSettled({ transportRef: { type: 'nostr-giftwrap', sender: 'stranger', txId: 'tx-1' } })
    await flushMicrotasks()

    expect(sendPrivateDirectMessage).not.toHaveBeenCalled()
  })

  it('does not send an ACK when no relay is connected', async () => {
    getRelayStatus.mockReturnValue([{ url: 'wss://relay-a.example.com', connected: false }])
    emitSettled()
    await flushMicrotasks()

    expect(sendPrivateDirectMessage).not.toHaveBeenCalled()
  })

  it('giftwrap missing sender/txId → no ACK', async () => {
    emitSettled({ transportRef: { type: 'nostr-giftwrap' } })
    await flushMicrotasks()

    expect(sendPrivateDirectMessage).not.toHaveBeenCalled()
  })

  it('processes no events after disconnect', async () => {
    disconnect()

    eventBus.emit({
      type: 'incoming:received',
      payload: { transfer: makeTransfer() },
    } as Parameters<EventBus['emit']>[0])
    emitSettled()
    await flushMicrotasks()

    expect(processIncomingTransfer).not.toHaveBeenCalled()
    expect(sendPrivateDirectMessage).not.toHaveBeenCalled()
  })
})
