import { toNumber } from '@/core/domain/amount'
import { createPendingTransfer, transitionPhase } from '@/core/domain/pending-transfer'
import type { BaseError } from '@/core/errors/base'
import { ServiceNotReadyError, UnknownError } from '@/core/errors/base'
import { TokenSpentError, KeysetSyncError } from '@/core/errors/cashu'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { useCallback } from 'react'

interface RedeemTokenResult {
  success: boolean
  amount?: number
  transactionId?: string
  error?: BaseError
}

/**
 * Parses a token to extract its amount and mint URL (supports cashuA/cashuB/CBOR).
 * The codec goes through the registry.inputParser port so the hook never instantiates
 * an adapter directly.
 */
function parseTokenInfo(
  inputParser: ServiceRegistry['inputParser'],
  token: string,
): { amount: number; mintUrl: string; memo?: string } | null {
  try {
    const inspection = inputParser.inspectCashuToken(token)
    return {
      amount: toNumber(inspection.amount),
      mintUrl: inspection.mint,
      memo: inspection.memo,
    }
  } catch (e) {
    // Diagnose the failure without echoing the token or its memo.
    console.warn('[parseTokenInfo] Failed to parse token:', e)
    return null
  }
}

/**
 * Polls until the transfer completes.
 */
async function waitForTransfer(
  serviceRegistry: ServiceRegistry,
  transferId: string,
  timeoutMs = 60000,
): Promise<{ success: boolean; amount?: number; error?: BaseError }> {
  const startTime = Date.now()
  const pollInterval = 500

  while (Date.now() - startTime < timeoutMs) {
    const transfer = await serviceRegistry.transferLifecycle.getTransfer(transferId)

    if (!transfer) {
      return { success: false, error: new UnknownError('transfer_not_found') }
    }

    if (transfer.phase === 'settled') {
      const ref = transfer.transportRef as { amount?: number } | undefined
      return { success: true, amount: ref?.amount }
    }

    if (transfer.phase === 'failed') {
      return { success: false, error: new UnknownError('redeem_failed') }
    }

    // Still preparing — keep waiting
    if (transfer.phase === 'preparing') {
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
      continue
    }

    // Other states (submitted / in_transit / awaiting_confirmation) also keep waiting
    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  return { success: false, error: new UnknownError('redeem_timeout') }
}

export function useRedeemToken(
  serviceRegistry: ServiceRegistry | null,
  onSuccess?: () => void,
) {
  return useCallback(async (token: string): Promise<RedeemTokenResult> => {
    if (!serviceRegistry?.transferLifecycle) {
      // Fallback: use the legacy payment.redeem (dual-run period)
      if (serviceRegistry?.payment) {
        const result = await serviceRegistry.payment.redeem({ input: token })
        if (result.ok) {
          onSuccess?.()
          return { success: true, amount: toNumber(result.value.amount), transactionId: result.value.requestId }
        }
        return { success: false, error: result.error }
      }
      return { success: false, error: new ServiceNotReadyError('transferLifecycle') }
    }

    // TransferLifecycleService-based token registration
    try {
      const tokenInfo = parseTokenInfo(serviceRegistry.inputParser, token)
      if (!tokenInfo) {
        return { success: false, error: new UnknownError('invalid_token') }
      }

      const transferId = crypto.randomUUID()
      const now = Date.now()

      const pendingTransfer = createPendingTransfer({
        id: transferId,
        txId: transferId,
        direction: 'incoming',
        finality: 'immediate',
        onExpiry: 'fail',
        transportRef: {
          type: 'ecash-incoming',
          content: token,
          amount: tokenInfo.amount,
          mintUrl: tokenInfo.mintUrl,
          memo: tokenInfo.memo,
        },
        now,
      })

      const submittedTransfer = transitionPhase(pendingTransfer, 'submitted', now)

      await serviceRegistry.transferLifecycle.registerTransfer(submittedTransfer)
      await serviceRegistry.transferLifecycle.processIncomingTransfer(transferId)

      const result = await waitForTransfer(serviceRegistry, transferId)

      if (result.success) {
        onSuccess?.()
        return {
          success: true,
          amount: result.amount ?? tokenInfo.amount,
          transactionId: transferId,
        }
      }

      return { success: false, error: result.error }
    } catch (error) {
      console.error('[useRedeemToken] Error:', error)
      // Preserve BaseError subtypes (TokenSpentError, KeysetSyncError, etc.)
      if (error instanceof TokenSpentError) {
        return { success: false, error }
      }
      if (error instanceof KeysetSyncError) {
        return { success: false, error }
      }
      if (error instanceof UnknownError) {
        return { success: false, error }
      }
      return {
        success: false,
        error: error instanceof Error ? new UnknownError(error.message) : new UnknownError('redeem_failed'),
      }
    }
  }, [serviceRegistry, onSuccess])
}
