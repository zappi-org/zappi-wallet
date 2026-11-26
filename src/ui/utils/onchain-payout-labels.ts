import type { TFunction } from 'i18next'
import type { OnchainPayoutStage } from '@/core/domain/onchain-payout'

export function isOnchainPayoutTerminalStage(stage: OnchainPayoutStage): boolean {
  return stage === 'completed' || stage === 'refunded' || stage === 'aborted'
}

export function onchainPayoutStageLabel(stage: OnchainPayoutStage, t: TFunction): string {
  switch (stage) {
    case 'paying':
      return t('onchainPayout.stage.paying')
    case 'funded':
      return t('onchainPayout.stage.funded')
    case 'sweeping':
      return t('onchainPayout.stage.sweeping')
    case 'completed':
      return t('onchainPayout.stage.completed')
    case 'refunded':
      return t('onchainPayout.stage.refunded')
    case 'aborted':
      return t('onchainPayout.stage.failed')
    default:
      return t('onchainPayout.stage.paying')
  }
}

export function onchainPayoutFailureLabel(reason: string, t: TFunction): string {
  switch (reason) {
    case 'prepare_failed':
      return t('onchainPayout.failure.prepareFailed')
    case 'interrupted_before_payment':
      return t('onchainPayout.failure.interrupted')
    case 'spent_by_provider':
      return t('onchainPayout.failure.reclaimed')
    case 'expired':
      return t('onchainPayout.failure.expired')
    case 'fee_too_high':
      return t('onchainPayout.failure.feeTooHigh')
    case 'too_close_to_locktime':
      return t('onchainPayout.failure.nearDeadline')
    default:
      return t('onchainPayout.failure.unknown')
  }
}

export function visibleOnchainPayoutFailureReason(
  stage: OnchainPayoutStage,
  reason: string | null,
): string | null {
  if (!reason) return null
  if (stage === 'refunded' || stage === 'aborted') return reason
  if (stage === 'funded' && (reason === 'fee_too_high' || reason === 'too_close_to_locktime')) {
    return reason
  }
  return null
}
