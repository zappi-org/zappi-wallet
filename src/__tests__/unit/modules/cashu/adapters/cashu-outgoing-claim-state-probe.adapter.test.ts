import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CashuOutgoingClaimStateProbeAdapter } from '@/modules/cashu/adapters/cashu-outgoing-claim-state-probe.adapter'
import * as cashuBackend from '@/modules/cashu/internal/cashu-backend'

vi.mock('@/modules/cashu/internal/cashu-backend', () => ({
  checkProofStates: vi.fn(),
  getSendOperationState: vi.fn(),
}))

describe('CashuOutgoingClaimStateProbeAdapter', () => {
  let adapter: CashuOutgoingClaimStateProbeAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(cashuBackend.getSendOperationState).mockResolvedValue(null)
    adapter = new CashuOutgoingClaimStateProbeAdapter()
  })

  it('maps all spent token state to claimed', async () => {
    vi.mocked(cashuBackend.checkProofStates).mockResolvedValue({
      allSpent: true,
      allPending: false,
      states: [{ secret: 's1', state: 'spent' }],
    })

    await expect(adapter.checkClaimState({ token: 'cashuAtoken' })).resolves.toBe('claimed')
  })

  it('maps all unspent token state to claimable', async () => {
    vi.mocked(cashuBackend.checkProofStates).mockResolvedValue({
      allSpent: false,
      allPending: false,
      states: [{ secret: 's1', state: 'unspent' }],
    })

    await expect(adapter.checkClaimState({ token: 'cashuAtoken' })).resolves.toBe('claimable')
  })

  it('treats mixed token states as pending instead of a status failure', async () => {
    vi.mocked(cashuBackend.checkProofStates).mockResolvedValue({
      allSpent: false,
      allPending: false,
      states: [
        { secret: 's1', state: 'unspent' },
        { secret: 's2', state: 'spent' },
      ],
    })

    await expect(adapter.checkClaimState({ token: 'cashuAtoken' })).resolves.toBe('pending')
  })

  it('maps pending proof state to a non-failure pending claim check', async () => {
    vi.mocked(cashuBackend.checkProofStates).mockResolvedValue({
      allSpent: false,
      allPending: true,
      states: [{ secret: 's1', state: 'pending' }],
    })

    await expect(adapter.checkClaimState({ token: 'cashuAtoken' })).resolves.toBe('pending')
  })

  it('uses finalized operation state as claimed when token is unavailable', async () => {
    vi.mocked(cashuBackend.getSendOperationState).mockResolvedValue('finalized')

    await expect(adapter.checkClaimState({ operationId: 'op-1' })).resolves.toBe('claimed')
    expect(cashuBackend.checkProofStates).not.toHaveBeenCalled()
  })

  it('uses rolled back operation state as reclaimed when token is unavailable', async () => {
    vi.mocked(cashuBackend.getSendOperationState).mockResolvedValue('rolled_back')

    await expect(adapter.checkClaimState({ operationId: 'op-1' })).resolves.toBe('reclaimed')
    expect(cashuBackend.checkProofStates).not.toHaveBeenCalled()
  })
})
