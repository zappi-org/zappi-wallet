import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CashuSendTokenOperatorAdapter } from '@/modules/cashu/adapters/cashu-send-token-operator.adapter'
import * as cashuBackend from '@/modules/cashu/internal/cashu-backend'

vi.mock('@/modules/cashu/internal/cashu-backend', () => ({
  rollbackSend: vi.fn(),
  finalizeSend: vi.fn(),
  checkProofStates: vi.fn(),
}))

describe('CashuSendTokenOperatorAdapter', () => {
  let adapter: CashuSendTokenOperatorAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new CashuSendTokenOperatorAdapter()
  })

  it('should rollback send by operationId', async () => {
    vi.mocked(cashuBackend.rollbackSend).mockResolvedValue(undefined)

    await adapter.rollbackSendToken('op1')

    expect(cashuBackend.rollbackSend).toHaveBeenCalledWith('op1')
  })

  it('should finalize send by operationId', async () => {
    vi.mocked(cashuBackend.finalizeSend).mockResolvedValue(undefined)

    await adapter.finalizeSend('op1')

    expect(cashuBackend.finalizeSend).toHaveBeenCalledWith('op1')
  })

  it('should check proof states for token', async () => {
    const mockResult = {
      allSpent: false,
      allPending: false,
      states: [{ secret: 'secret1', state: 'unspent' as const }],
    }
    vi.mocked(cashuBackend.checkProofStates).mockResolvedValue(mockResult)

    const result = await adapter.checkProofStates('cashuAtoken')

    expect(cashuBackend.checkProofStates).toHaveBeenCalledWith('cashuAtoken')
    expect(result).toEqual(mockResult)
  })
})
