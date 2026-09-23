import type { ChatMessage } from '@/core/domain/chat'
import type { Transaction } from '@/core/domain/transaction'
import { encodeChatPaymentNotice } from '@/core/domain/chat-payment'
import { describe, expect, it, vi } from 'vitest'
import { executeChatPayment, hasSubmittedChatRequest } from '@/ui/screens/Chat/chat-payment-flow'
import type { RouteExecutionResult } from '@/core/domain/routing'

const launch = {
  conversationId: 'original-chat',
  peer: 'a'.repeat(64),
  requestMessageId: 'request-1',
}
const result: RouteExecutionResult = {
  status: 'in_transit',
  amount: 250,
  fee: 2,
  sourceMintUrl: 'https://mint.test',
  transactionId: 'tx-1',
}

describe('chat payment handoff', () => {
  it('preserves the real payment result when announcing it fails, without paying again', async () => {
    const execute = vi.fn().mockResolvedValue(result)
    const enqueue = vi.fn().mockRejectedValue(new Error('Storage full'))
    const submitted = vi.fn()
    const outcome = await executeChatPayment(
      launch,
      execute,
      enqueue,
      submitted
    )
    expect(outcome.result).toBe(result)
    await expect(outcome.noticeSaved).resolves.toBe(false)
    expect(execute).toHaveBeenCalledOnce()
    expect(enqueue).toHaveBeenCalledOnce()
    expect(submitted).toHaveBeenCalledOnce()
  })

  it('links the original conversation/request to the existing mint transaction', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined)
    await executeChatPayment(launch, async () => result, enqueue)
    expect(enqueue).toHaveBeenCalledWith('original-chat', expect.any(String), {
      kind: 'send',
      transactionId: 'tx-1',
      amount: 250,
      requestMessageId: 'request-1',
    })
    const notice = JSON.parse(enqueue.mock.calls[0][1])
    expect(notice).toMatchObject({ recipient: launch.peer, amount: 250 })
    expect(notice).not.toHaveProperty('status')
    expect(notice).not.toHaveProperty('sourceMintUrl')
  })

  it('does not announce a failed payment', async () => {
    const enqueue = vi.fn()
    const failed = { ...result, status: 'failed' as const }
    const outcome = await executeChatPayment(
      launch,
      async () => failed,
      enqueue
    )
    expect(outcome.result).toBe(failed)
    await expect(outcome.noticeSaved).resolves.toBe(true)
    expect(enqueue).not.toHaveBeenCalled()
  })

  it('returns the wallet result while chat storage is still pending', async () => {
    let stored!: () => void
    const enqueue = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          stored = resolve
        })
    )
    const submitted = vi.fn()
    const outcome = await executeChatPayment(
      launch,
      async () => result,
      enqueue,
      submitted
    )
    expect(outcome.result).toBe(result)
    expect(submitted).toHaveBeenCalledOnce()
    stored()
    await expect(outcome.noticeSaved).resolves.toBe(true)
    expect(enqueue).toHaveBeenCalledOnce()
  })
})

it('does not execute a request that expired while the confirmation screen was open', async () => {
  const execute = vi.fn().mockResolvedValue(result)
  const enqueue = vi.fn()
  const submitted = vi.fn()
  const outcome = await executeChatPayment(
    { ...launch, expiresAt: Date.now() - 1 },
    execute,
    enqueue,
    submitted
  )
  expect(outcome.expired).toBe(true)
  expect(outcome.result).toBeNull()
  expect(execute).not.toHaveBeenCalled()
  expect(enqueue).not.toHaveBeenCalled()
  expect(submitted).not.toHaveBeenCalled()
})

it('blocks an already submitted request immediately before payment', async () => {
  const execute = vi.fn().mockResolvedValue(result)
  const outcome = await executeChatPayment(launch, execute, vi.fn(), vi.fn(), () => true)
  expect(outcome.duplicate).toBe(true)
  expect(execute).not.toHaveBeenCalled()
})

it('serializes concurrent attempts to pay the same request', async () => {
  let resolve!: (value: RouteExecutionResult) => void
  const execute = vi.fn(() => new Promise<RouteExecutionResult>(done => { resolve = done }))
  const first = executeChatPayment(launch, execute, vi.fn())
  await Promise.resolve()
  const second = await executeChatPayment(launch, execute, vi.fn())
  expect(second.duplicate).toBe(true)
  expect(execute).toHaveBeenCalledOnce()
  resolve(result)
  await first
})

it('releases an attempt after a failed execution and fails closed on lookup errors', async () => {
  const execute = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(result)
  await expect(executeChatPayment(launch, execute, vi.fn())).rejects.toThrow('network')
  await expect(executeChatPayment(launch, execute, vi.fn(), undefined, () => { throw new Error('lookup') })).rejects.toThrow('lookup')
  const outcome = await executeChatPayment(launch, execute, vi.fn())
  expect(outcome.result).toBe(result)
  expect(execute).toHaveBeenCalledTimes(2)
})

it('blocks a repeat when the payment succeeded but its notice failed', async () => {
  let submitted = false
  const execute = vi.fn().mockResolvedValue(result)
  const enqueue = vi.fn().mockRejectedValue(new Error('storage'))
  const first = await executeChatPayment(launch, execute, enqueue, () => { submitted = true }, () => submitted)
  await expect(first.noticeSaved).resolves.toBe(false)
  const second = await executeChatPayment(launch, execute, enqueue, undefined, () => submitted)
  expect(second.duplicate).toBe(true)
  expect(execute).toHaveBeenCalledOnce()
})

const paymentMessage: ChatMessage = {
  id: 'notice-1', conversationId: launch.conversationId, sender: 'b'.repeat(64),
  recipient: launch.peer, createdAt: 1, outgoing: true, status: 'sent',
  payment: { kind: 'send', transactionId: 'tx-1', amount: 250, requestMessageId: 'request-1' },
  content: encodeChatPaymentNotice({ amount: 250, unit: 'sat', recipient: launch.peer, transactionId: 'tx-1', requestMessageId: 'request-1' }),
}
const transaction: Transaction = {
  id: 'tx-1', direction: 'send', method: 'ecash', protocol: 'nut18',
  amount: { value: 250n, unit: 'sat' }, accountId: 'mint', status: 'settled', createdAt: 1,
}

describe('submitted request lookup', () => {
  it.each(['pending', 'settled'] as const)('blocks verified %s local transfers even if the chat notice failed', async status => {
    const getTransaction = vi.fn().mockResolvedValue({ ...transaction, status })
    expect(await hasSubmittedChatRequest(launch, [{ ...paymentMessage, status: 'failed' }], getTransaction)).toBe(true)
  })

  it('does not trust incoming payment claims or mismatched local links', async () => {
    const getTransaction = vi.fn().mockResolvedValue(transaction)
    for (const message of [
      { ...paymentMessage, outgoing: false },
      { ...paymentMessage, conversationId: 'another-conversation' },
      { ...paymentMessage, recipient: 'c'.repeat(64) },
      { ...paymentMessage, payment: undefined },
      { ...paymentMessage, content: paymentMessage.content.replace('250', '251') },
    ]) expect(await hasSubmittedChatRequest(launch, [message], getTransaction)).toBe(false)
    expect(getTransaction).not.toHaveBeenCalled()
  })

  it('does not treat failed or mismatched wallet transactions as submitted', async () => {
    for (const value of [
      { ...transaction, status: 'failed' },
      { ...transaction, direction: 'receive' },
      { ...transaction, id: 'another-tx' },
      { ...transaction, amount: { value: 249n, unit: 'sat' } },
    ]) expect(await hasSubmittedChatRequest(launch, [paymentMessage], vi.fn().mockResolvedValue(value))).toBe(false)
  })

  it('fails closed if the linked transaction cannot be loaded', async () => {
    await expect(hasSubmittedChatRequest(launch, [paymentMessage], async () => null)).rejects.toThrow('unavailable')
    await expect(hasSubmittedChatRequest(launch, [paymentMessage], async () => { throw new Error('storage') })).rejects.toThrow('storage')
  })

  it('uses the session guard when the notice is not yet stored and leaves direct sends unrestricted', async () => {
    const getTransaction = vi.fn()
    expect(await hasSubmittedChatRequest(launch, [], getTransaction, true)).toBe(true)
    expect(await hasSubmittedChatRequest({ ...launch, requestMessageId: undefined }, [], getTransaction, true)).toBe(false)
    expect(getTransaction).not.toHaveBeenCalled()
  })
})
