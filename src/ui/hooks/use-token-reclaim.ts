import type { BaseError } from '@/core/errors/base'
import { TokenSpentByRecipientError } from '@/core/errors/reclaim'
import { useReclaim } from '@/ui/hooks/use-reclaim'
import { translateError } from '@/ui/utils/error-i18n'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'

export interface ReclaimTokenResult {
  success: boolean
  alreadySpent?: boolean
  spentByRecipient?: boolean
  error?: BaseError
}

export function useTokenReclaim() {
  const { t } = useTranslation()
  const { reclaim } = useReclaim()
  const addToast = useAppStore((s) => s.addToast)

  const reclaimToken = async (tokenId: string): Promise<ReclaimTokenResult> => {
    const result = await reclaim(tokenId)

    if (!result.success) {
      // TokenSpentByRecipientError 체크: 상대방이 이미 수령함
      const spentByRecipient = result.error instanceof TokenSpentByRecipientError
      const alreadySpent = spentByRecipient || result.alreadySpent
      
      // 글로벌 토스트 처리
      if (spentByRecipient) {
        addToast({ type: 'info', message: t('txDetail.consumedByRecipient'), duration: 3000 })
      } else {
        const errorMessage = result.error ? translateError(result.error, t) : t('token.reclaim.failed')
        addToast({ type: 'error', message: errorMessage, duration: 3000 })
      }
      
      return { 
        success: false, 
        alreadySpent, 
        spentByRecipient,
        error: result.error 
      }
    }

    // 성공 토스트
    addToast({ type: 'success', message: t('txDetail.reclaimSuccess'), duration: 3000 })
    return { success: true }
  }

  const reclaimMultiple = async (
    tokenIds: string[],
    options?: {
      onSuccess?: () => void
      onError?: () => void
    }
  ): Promise<ReclaimTokenResult> => {
    for (const id of tokenIds) {
      const result = await reclaimToken(id)
      if (!result.success) {
        options?.onError?.()
        return result
      }
    }
    options?.onSuccess?.()
    return { success: true }
  }

  return { reclaimToken, reclaimMultiple }
}
