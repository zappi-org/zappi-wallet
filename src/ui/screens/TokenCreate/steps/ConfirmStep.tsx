import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { Button } from '@/ui/components/common/Button'
import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { useFormatFiat, useFormatSats } from '@/utils/format'
import { useWallet } from '@/ui/hooks/use-wallet'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { translateError } from '@/ui/utils/error-i18n'
import { hapticError } from '@/ui/utils/haptic'
import { Trans, useTranslation } from 'react-i18next'
import { useCallback, useEffect, useMemo, useState } from 'react'

export interface ConfirmStepProps {
  amount: number
  memo: string
  senderPaysFee: boolean
  mintUrl: string
  onBack: () => void
  /** Executes token creation; resolves after the flow transitions on success. */
  onConfirm: () => Promise<void>
  /** Optional live fee estimate. Returns null when unavailable or 0 when the mint charges no fee. */
  onEstimateFee?: (mintUrl: string, amount: number) => Promise<number | null>
}

export function ConfirmStep({
  amount,
  memo,
  senderPaysFee,
  mintUrl,
  onBack,
  onConfirm,
  onEstimateFee,
}: ConfirmStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const { balance } = useWallet()
  const addToast = useAppStore((s) => s.addToast)
  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)

  const [busy, setBusy] = useState(false)
  const [fee, setFee] = useState<number | null>(null)

  useEffect(() => {
    if (!onEstimateFee || amount <= 0) return
    let cancelled = false
    onEstimateFee(mintUrl, amount)
      .then((value) => {
        if (!cancelled) setFee(value)
      })
      .catch(() => {
        if (!cancelled) setFee(null)
      })
    return () => {
      cancelled = true
    }
  }, [mintUrl, amount, onEstimateFee])

  const mintBalance = balance.byMint[mintUrl] ?? 0
  const mintName = getDisplayName(mintUrl)
  const mintIconUrl = getIconUrl(mintUrl)

  const appliedFee = fee ?? 0
  const tokenAmount = senderPaysFee ? amount + appliedFee : amount
  const postBalance = mintBalance - tokenAmount - appliedFee
  const fiatLabel = formatFiat(tokenAmount)
  const showFeeRow = fee !== null && fee > 0

  const handleConfirm = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await onConfirm()
    } catch (error) {
      hapticError()
      addToast({ type: 'error', message: translateError(error, t) })
    } finally {
      setBusy(false)
    }
  }, [busy, onConfirm, addToast, t])

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('send.tokenCreate.confirmTitle')} onBack={onBack} />

      {/* Centered flowing question */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="text-center">
          <p className="text-heading font-semibold text-foreground whitespace-pre-line">
            <Trans
              i18nKey="send.tokenCreate.confirmQuestion"
              values={{ mint: mintName, amount: formatSats(tokenAmount) }}
              components={{ b: <span className="text-brand" /> }}
            />
          </p>
          {fiatLabel && <p className="text-body text-foreground-muted mt-3">~ {fiatLabel}</p>}
        </div>
      </div>

      {/* Bottom panel: warning + detail rows + button */}
      <BottomActionBar extraBottom={16} gap="none" className="px-6">
        {/* Warning */}
        <div className="px-4 py-3 rounded-card bg-background-card mb-4">
          <p className="text-caption text-foreground leading-relaxed">
            {t('send.tokenCreate.reclaimNote')}
          </p>
        </div>

        {/* Detail rows */}
        <div className="mb-4">
          {memo && (
            <div className="flex justify-between py-2.5 border-b border-border/50">
              <span className="text-body text-foreground-muted">{t('common.memo')}</span>
              <span className="text-body font-medium text-foreground truncate max-w-[200px]">
                {memo}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center py-2.5 border-b border-border/50">
            <span className="text-body text-foreground-muted">{t('send.tokenCreate.mintLabel')}</span>
            <div className="flex items-center gap-2">
              <MintIcon iconUrl={mintIconUrl} imgSize="w-5 h-5" className="w-5 h-5" circle />
              <span className="text-body font-medium text-foreground">{mintName}</span>
            </div>
          </div>
          {showFeeRow && (
            <div className="flex justify-between py-2.5 border-b border-border/50">
              <span className="text-body text-foreground-muted">{t('send.tokenCreate.createFee')}</span>
              <span className="text-body font-medium text-foreground">
                {formatSats(appliedFee)}
              </span>
            </div>
          )}
          <div className="flex justify-between py-2.5">
            <span className="text-body font-bold text-foreground">{t('send.tokenCreate.postBalance')}</span>
            <span className="text-body font-bold text-foreground">
              {formatSats(postBalance)}
            </span>
          </div>
        </div>

        <Button
          variant="brand"
          size="xl"
          onClick={handleConfirm}
          disabled={busy}
          className="w-full"
        >
          {busy ? t('send.tokenCreate.creating') : t('common.next')}
        </Button>
      </BottomActionBar>
    </div>
  )
}
