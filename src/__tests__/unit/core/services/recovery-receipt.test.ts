import { describe, expect, it, vi } from 'vitest'
import { RecoveryService } from '@/core/services/recovery.service'
import { amount } from '@/core/domain/amount'

function setup(trusted = true, patch: Record<string, unknown> = {}, requestId?: string) {
  const token = 'cashuAtest'
  const sender = 'a'.repeat(64)
  const recipient = 'b'.repeat(64)
  const eventId = 'c'.repeat(64)
  const transaction = {
    id: 'local-recovery', direction: 'receive', status: 'settled',
    accountId: 'https://mint.test', amount: amount(98, 'sat'),
    fee: { quoted: amount(2, 'sat'), effective: amount(2, 'sat') },
    metadata: { token }, ...patch,
  }
  const update = vi.fn()
  const save = vi.fn()
  const enqueue = vi.fn()
  const markProcessed = vi.fn()
  const receiveToken = vi.fn().mockResolvedValue({ ok: true, value: { transactionId: transaction.id, amount: 98 } })
  const deps = [
    { fetchGiftWraps: vi.fn().mockResolvedValue([{ eventId, sender, content: requestId ? JSON.stringify({ type: "cashu_token", token, request_id: requestId }) : token }]) },
    {}, { isProcessed: vi.fn().mockResolvedValue(false), markProcessed, saveAnchor: vi.fn() }, {},
    { receiveToken }, { hasTrustedMint: vi.fn().mockResolvedValue(trusted) }, { enqueue },
    { inspectCashuToken: vi.fn().mockReturnValue({ mint: 'https://mint.test', amount: amount(100, 'sat') }) },
    undefined, { exists: vi.fn().mockResolvedValue(false), save },
    { getById: vi.fn().mockResolvedValue(transaction), update },
  ] as unknown as ConstructorParameters<typeof RecoveryService>
  return { service: new RecoveryService(...deps), update, save, enqueue, markProcessed, receiveToken,
    token, sender, recipient, eventId,
    params: { privateKey: 'key', publicKey: recipient, relays: ['wss://relay.test'] },
  }
}

describe('offline receipt correlation', () => {
  it('persists authenticated delivery and actual local receipt mapping after catch-up', async () => {
    const ctx = setup()
    const result = await ctx.service.reconstructState(ctx.params)
    expect(result.tokensReceived).toBe(1)
    expect(ctx.update).toHaveBeenCalledWith('local-recovery', { metadata: {
      token: ctx.token, paymentDelivery: { id: ctx.eventId, sender: ctx.sender, recipient: ctx.recipient, amount: 100 },
    } })
    expect(ctx.save).toHaveBeenLastCalledWith(expect.objectContaining({ externalId: ctx.eventId, txId: 'local-recovery', result: 'success' }))
  })
  it('persists the original payment request reference during recovery', async () => {
    const ctx = setup(true, {}, 'request-ref')
    await ctx.service.reconstructState(ctx.params)
    expect(ctx.update).toHaveBeenCalledWith('local-recovery', expect.objectContaining({
      metadata: expect.objectContaining({ paymentDelivery: expect.objectContaining({ requestId: 'request-ref' }) }),
    }))
  })
  it('preserves the authenticated recipient while an unknown mint awaits approval', async () => {
    const ctx = setup(false)
    await ctx.service.reconstructState(ctx.params)
    expect(ctx.enqueue).toHaveBeenCalledWith(expect.objectContaining({ senderPubkey: ctx.sender, recipientPubkey: ctx.recipient }))
    expect(ctx.receiveToken).not.toHaveBeenCalled()
  })
  it('does not claim success for an unrelated local token receipt', async () => {
    const ctx = setup(true, { metadata: { token: 'different-token' } })
    const result = await ctx.service.reconstructState(ctx.params)
    expect(result.tokensReceived).toBe(0)
    expect(ctx.update).not.toHaveBeenCalled()
    expect(ctx.save).not.toHaveBeenCalledWith(expect.objectContaining({ result: 'success' }))
  })
})
