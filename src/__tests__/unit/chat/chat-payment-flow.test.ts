import { describe, expect, it, vi } from 'vitest'
import { executeChatPayment } from '@/ui/screens/Chat/chat-payment-flow'
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
