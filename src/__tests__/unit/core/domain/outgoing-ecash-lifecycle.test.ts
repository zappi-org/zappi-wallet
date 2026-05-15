import { describe, expect, it } from 'vitest'
import {
  applyClaimCheckResult,
  applyDeliveryResult,
  canReclaimOutgoingEcash,
  createOutgoingEcashOperation,
  deriveOutgoingEcashDisplayState,
} from '@/core/domain/outgoing-ecash-lifecycle'

const baseOperation = () => createOutgoingEcashOperation({
  txId: 'tx-1',
  kind: 'direct-nostr-send',
  accountId: 'https://mint.test',
  amount: 10,
  token: 'cashuAtoken',
  operationId: 'op-1',
  delivery: 'pending_publish',
  now: 1_000,
})

describe('outgoing ecash lifecycle domain', () => {
  it('separates delivery publication from recipient claim', () => {
    const published = applyDeliveryResult(baseOperation(), 'published', 2_000)

    expect(published.delivery).toBe('published')
    expect(published.claim).toBe('unclaimed')
    expect(deriveOutgoingEcashDisplayState(published)).toBe('published_waiting_claim')
  })

  it('maps adapter claim results without exposing token internals', () => {
    const operation = applyDeliveryResult(baseOperation(), 'published', 2_000)

    expect(applyClaimCheckResult(operation, 'claimable', 3_000).claim).toBe('unclaimed')
    const pending = applyClaimCheckResult(operation, 'pending', 3_000)
    expect(pending.claim).toBe('claim_pending')
    expect(deriveOutgoingEcashDisplayState(pending)).toBe('published_waiting_claim')
    expect(applyClaimCheckResult(operation, 'claimed', 3_000).claim).toBe('claimed')
    expect(applyClaimCheckResult(operation, 'reclaimed', 3_000).claim).toBe('reclaimed')
    expect(applyClaimCheckResult(operation, 'unknown', 3_000).claim).toBe('unclaimed')
  })

  it('disables reclaim while delivery is still publishing', () => {
    expect(canReclaimOutgoingEcash(baseOperation())).toBe(false)
    expect(canReclaimOutgoingEcash(applyDeliveryResult(baseOperation(), 'published', 2_000))).toBe(true)
    expect(canReclaimOutgoingEcash(applyClaimCheckResult(baseOperation(), 'pending', 2_000))).toBe(false)
  })
})
