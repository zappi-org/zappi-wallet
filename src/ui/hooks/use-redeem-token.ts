import { toNumber } from '@/core/domain/amount'
import { createPendingTransfer, transitionPhase } from '@/core/domain/pending-transfer'
import type { BaseError } from '@/core/errors/base'
import { ServiceNotReadyError, UnknownError } from '@/core/errors/base'
import { TokenSpentError, KeysetSyncError } from '@/core/errors/cashu'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { TokenCodecAdapter } from '@/adapters/codec/token-codec.adapter'
import { useCallback } from 'react'

// TokenCodecAdapter singleton (pure adapter, no deps)
const tokenCodec = new TokenCodecAdapter()

interface RedeemTokenResult {
  success: boolean
  amount?: number
  transactionId?: string
  error?: BaseError
}

/**
 * Token을 파싱하여 금액과 민트 URL을 추출
 * TokenCodecAdapter 사용 (cashuA/cashuB/CBOR 모두 지원)
 */
function parseTokenInfo(token: string): { amount: number; mintUrl: string } | null {
  try {
    console.log('[parseTokenInfo] Input token length:', token.length, 'starts with:', token.slice(0, 20))
    
    const inspection = tokenCodec.inspectCashuToken(token)
    const amount = toNumber(inspection.amount)
    const mintUrl = inspection.mint
    
    console.log('[parseTokenInfo] TokenCodec result:', { amount, mintUrl })
    return { amount, mintUrl }
  } catch (e) {
    console.log('[parseTokenInfo] Parse error:', e)
    return null
  }
}

/**
 * Polling으로 transfer 완료 대기
 */
async function waitForTransfer(
  serviceRegistry: ServiceRegistry,
  transferId: string,
  timeoutMs = 60000,
): Promise<{ success: boolean; amount?: number; error?: BaseError }> {
  const startTime = Date.now()
  const pollInterval = 500
  let loopCount = 0

  while (Date.now() - startTime < timeoutMs) {
    loopCount++
    const transfer = await serviceRegistry.transferLifecycle.getTransfer(transferId)

    if (!transfer) {
      console.log('[waitForTransfer] Transfer not found:', transferId)
      return { success: false, error: new UnknownError('transfer_not_found') }
    }

    if (loopCount <= 5 || transfer.phase !== 'submitted') {
      console.log('[waitForTransfer] Loop', loopCount, 'phase:', transfer.phase)
    }

    if (transfer.phase === 'settled') {
      // transportRef에서 amount 추출
      const ref = transfer.transportRef as { amount?: number } | undefined
      console.log('[waitForTransfer] Settled! amount:', ref?.amount)
      return { success: true, amount: ref?.amount }
    }

    if (transfer.phase === 'failed') {
      console.log('[waitForTransfer] Failed!')
      return { success: false, error: new UnknownError('redeem_failed') }
    }

    // preparing 상태면 아직 처리 중 - 계속 대기
    if (transfer.phase === 'preparing') {
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
      continue
    }

    // submitted / in_transit / awaiting_confirmation 등 다른 상태도 계속 대기
    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  console.log('[waitForTransfer] Timeout!')
  return { success: false, error: new UnknownError('redeem_timeout') }
}

export function useRedeemToken(
  serviceRegistry: ServiceRegistry | null,
  onSuccess?: () => void,
) {
  return useCallback(async (token: string): Promise<RedeemTokenResult> => {
    if (!serviceRegistry?.transferLifecycle) {
      // Fallback: 기존 payment.redeem 사용 (dual-run 기간)
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

    // TLS 기반 토큰 등록
    try {
      // 1. 토큰 정보 파싱
      const tokenInfo = parseTokenInfo(token)
      console.log('[useRedeemToken] Parsed token:', tokenInfo)
      if (!tokenInfo) {
        return { success: false, error: new UnknownError('invalid_token') }
      }

      const transferId = crypto.randomUUID()
      const now = Date.now()

      // 2. PendingTransfer 생성 (direction: 'incoming')
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
        },
        now,
      })

      // 3. 'submitted' 상태로 전이 (바로 처리 가능)
      const submittedTransfer = transitionPhase(pendingTransfer, 'submitted', now)

      // 4. Transfer 등록
      console.log('[useRedeemToken] Registering transfer:', transferId)
      await serviceRegistry.transferLifecycle.registerTransfer(submittedTransfer)

      // 5. Incoming 처리 실행
      console.log('[useRedeemToken] Calling processIncomingTransfer:', transferId)
      await serviceRegistry.transferLifecycle.processIncomingTransfer(transferId)

      // 6. 완료 대기 (polling)
      console.log('[useRedeemToken] Waiting for transfer completion:', transferId)
      const result = await waitForTransfer(serviceRegistry, transferId)
      console.log('[useRedeemToken] Transfer result:', result)

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
      // BaseError 타입 보존 (TokenSpentError, KeysetSyncError 등)
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
