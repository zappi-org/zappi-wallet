import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check } from 'lucide-react'
import { Modal } from '@/ui/components/common/Modal'
import { Button } from '@/ui/components/common/Button'
import { useFormatSats } from '@/utils/format'
import { useAppStore } from '@/store'
import type { OnchainPayoutView } from '@/core/ports/driving/onchain-payout.usecase'
import { selectOnchainPayoutById } from '@/store/selectors'
import {
  onchainPayoutFailureLabel,
  onchainPayoutStageLabel,
  visibleOnchainPayoutFailureReason,
} from '@/ui/utils/onchain-payout-labels'

export function OnchainPayoutProgressView({
  payout,
  onClose,
}: {
  payout: OnchainPayoutView
  onClose: () => void
}) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const addToast = useAppStore((state) => state.addToast)
  const [copied, setCopied] = useState(false)
  const failureReason = visibleOnchainPayoutFailureReason(payout.stage, payout.failureReason)

  const copyTxId = useCallback(async () => {
    if (!payout.payoutTxId) return
    try {
      await navigator.clipboard.writeText(payout.payoutTxId)
      setCopied(true)
      addToast({ type: 'success', message: t('common.copied'), duration: 2000 })
    } catch {
      addToast({ type: 'error', message: t('errors.clipboardError'), duration: 2000 })
    }
  }, [payout.payoutTxId, addToast, t])

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center text-center gap-2 py-4">
        <span className="text-caption font-medium text-foreground-muted">
          {t('onchainPayout.title')}
        </span>
        <span className="text-heading font-semibold text-foreground">
          {onchainPayoutStageLabel(payout.stage, t)}
        </span>
        <span className="text-title font-bold text-foreground">
          {formatSats(payout.receiveAmount)}
        </span>
        <span className="text-label text-foreground-muted break-all">{payout.destination}</span>
      </div>

      {payout.payoutTxId && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-foreground/[0.04] px-3 py-2.5">
          <span className="text-label text-foreground-muted truncate">{payout.payoutTxId}</span>
          <button
            type="button"
            onClick={copyTxId}
            aria-label={t('onchainPayout.copyTx')}
            className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-foreground-muted hover:bg-foreground/[0.06]"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      )}

      {failureReason && (
        <p className="text-label text-foreground-muted text-center" data-testid="onchain-payout-failure">
          {onchainPayoutFailureLabel(failureReason, t)}
        </p>
      )}

      <Button variant="secondary" onClick={onClose}>
        {t('common.close')}
      </Button>
    </div>
  )
}

export function OnchainPayoutProgressModal({
  payoutId,
  onClose,
}: {
  payoutId: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const payout = useAppStore(useMemo(() => selectOnchainPayoutById(payoutId), [payoutId]))
  return (
    <Modal
      isOpen={payout !== null}
      onClose={onClose}
      title={t('onchainPayout.title')}
      testId="onchain-payout-progress"
    >
      {payout && <OnchainPayoutProgressView payout={payout} onClose={onClose} />}
    </Modal>
  )
}
