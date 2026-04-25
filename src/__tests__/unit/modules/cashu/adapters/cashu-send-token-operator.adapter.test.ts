import { describe, expect, it, vi } from 'vitest'
import { CashuSendTokenOperatorAdapter } from '@/modules/cashu/adapters/cashu-send-token-operator.adapter'
import { sat } from '@/core/domain/amount'

describe('CashuSendTokenOperatorAdapter', () => {
  it('routes token-only reclaim through the backend receive path', async () => {
    const backend = {
      rollbackSend: vi.fn(),
      finalizeSend: vi.fn(),
      receiveToken: vi.fn().mockResolvedValue({
        amount: 990,
        fee: 10,
        unit: 'sat',
        mintUrl: 'https://mint.test',
      }),
      checkProofStates: vi.fn(),
    }
    const adapter = new CashuSendTokenOperatorAdapter(backend)

    const result = await adapter.reclaimToken('cashuAtoken')

    expect(backend.receiveToken).toHaveBeenCalledWith('cashuAtoken')
    expect(result).toEqual({
      amount: sat(990),
      fee: sat(10),
      accountId: 'https://mint.test',
    })
  })
})
