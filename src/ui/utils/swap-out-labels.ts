import type { TFunction } from 'i18next'
import type { SwapOutStage } from '@/core/domain/swap-out'

export function isSwapOutTerminalStage(stage: SwapOutStage): boolean {
  return stage === 'completed' || stage === 'refunded' || stage === 'aborted'
}

export function swapOutStageLabel(stage: SwapOutStage, t: TFunction): string {
  switch (stage) {
    case 'paying':
      return t('swapOut.stage.paying')
    case 'funded':
      return t('swapOut.stage.funded')
    case 'sweeping':
      return t('swapOut.stage.sweeping')
    case 'completed':
      return t('swapOut.stage.completed')
    case 'refunded':
      return t('swapOut.stage.refunded')
    case 'aborted':
      return t('swapOut.stage.failed')
    default:
      return t('swapOut.stage.paying')
  }
}

export function swapOutFailureLabel(reason: string, t: TFunction): string {
  switch (reason) {
    case 'prepare_failed':
      return t('swapOut.failure.prepareFailed')
    case 'interrupted_before_payment':
      return t('swapOut.failure.interrupted')
    case 'spent_by_provider':
      return t('swapOut.failure.reclaimed')
    case 'expired':
      return t('swapOut.failure.expired')
    case 'fee_too_high':
      return t('swapOut.failure.feeTooHigh')
    case 'too_close_to_locktime':
      return t('swapOut.failure.nearDeadline')
    default:
      return t('swapOut.failure.unknown')
  }
}

export function visibleSwapOutFailureReason(
  stage: SwapOutStage,
  reason: string | null,
): string | null {
  if (!reason) return null
  if (stage === 'refunded' || stage === 'aborted') return reason
  if (stage === 'funded' && (reason === 'fee_too_high' || reason === 'too_close_to_locktime')) {
    return reason
  }
  return null
}
