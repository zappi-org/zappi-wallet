/**
 * GiftWrapSettlementBridge — giftwrap 자동 redeem + POS ACK 계약 안전망 (감사 잔여 Phase 0)
 *
 * 핀 대상 계약:
 * - incoming:received 의 nostr-giftwrap(incoming)만 processIncomingTransfer 로 전달
 * - processIncoming 실패는 브리지 안에서 소화 (unhandled rejection 금지)
 * - transfer:settled: 등록된 POS 기기의 giftwrap 만, 연결된 릴레이가 있을 때만 delivery ACK
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
    disconnect() // 이중 호출 안전 — EventBus off 는 Set.delete
  })

  // ─── incoming:received → 자동 redeem ───

  it('nostr-giftwrap incoming → processIncomingTransfer(transfer.id)', async () => {
    eventBus.emit({
      type: 'incoming:received',
      payload: { transfer: makeTransfer() },
    } as Parameters<EventBus['emit']>[0])
    await flushMicrotasks()

    expect(processIncomingTransfer).toHaveBeenCalledWith('transfer-1')
  })

  it('giftwrap 이 아닌 transportRef 는 처리하지 않는다', async () => {
    eventBus.emit({
      type: 'incoming:received',
      payload: { transfer: makeTransfer({ transportRef: { type: 'cashu-token' } }) },
    } as Parameters<EventBus['emit']>[0])
    await flushMicrotasks()

    expect(processIncomingTransfer).not.toHaveBeenCalled()
  })

  it('outgoing 방향은 처리하지 않는다', async () => {
    eventBus.emit({
      type: 'incoming:received',
      payload: { transfer: makeTransfer({ direction: 'outgoing' }) },
    } as Parameters<EventBus['emit']>[0])
    await flushMicrotasks()

    expect(processIncomingTransfer).not.toHaveBeenCalled()
  })

  it('processIncoming 실패는 warn 으로 소화된다', async () => {
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

  it('등록된 POS 기기의 settled giftwrap → 연결된 릴레이로만 delivery_ack 전송', async () => {
    emitSettled()
    await flushMicrotasks()

    expect(sendPrivateDirectMessage).toHaveBeenCalledWith({
      recipientPubkey: POS_PUBKEY,
      content: JSON.stringify({ type: 'delivery_ack', txId: 'tx-1' }),
      relays: ['wss://relay-a.example.com'], // connected=false 릴레이 제외
    })
  })

  it('등록되지 않은 sender 는 ACK 없음', async () => {
    emitSettled({ transportRef: { type: 'nostr-giftwrap', sender: 'stranger', txId: 'tx-1' } })
    await flushMicrotasks()

    expect(sendPrivateDirectMessage).not.toHaveBeenCalled()
  })

  it('연결된 릴레이가 없으면 ACK 를 보내지 않는다', async () => {
    getRelayStatus.mockReturnValue([{ url: 'wss://relay-a.example.com', connected: false }])
    emitSettled()
    await flushMicrotasks()

    expect(sendPrivateDirectMessage).not.toHaveBeenCalled()
  })

  it('sender/txId 누락 giftwrap 은 ACK 없음', async () => {
    emitSettled({ transportRef: { type: 'nostr-giftwrap' } })
    await flushMicrotasks()

    expect(sendPrivateDirectMessage).not.toHaveBeenCalled()
  })

  it('disconnect 후에는 어떤 이벤트도 처리하지 않는다', async () => {
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
