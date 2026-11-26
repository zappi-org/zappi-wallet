import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { Button } from '@/ui/components/common/Button'
import { Skeleton } from '@/ui/components/common/Skeleton'
import { EmptyState } from '@/ui/components/common/EmptyState'
import { ProviderMark } from '@/ui/components/payment/ProviderMark'
import { useFormatSats } from '@/utils/format'
import { cn } from '@/ui/lib/utils'
import type { OnchainPayoutOffer } from '@/core/ports/driving/onchain-payout.usecase'
import { formatFeePercent, shortenIdentifier } from './payout-form'

export interface OnchainPayoutProviderStepProps {
  offers: OnchainPayoutOffer[] | null
  loading: boolean
  error: string | null
  selectedOfferId: string | null
  onSelect: (offerId: string) => void
  onRetry: () => void
  onNext: () => void
  onBack: () => void
}

export function OnchainPayoutProviderStep({
  offers,
  loading,
  error,
  selectedOfferId,
  onSelect,
  onRetry,
  onNext,
  onBack,
}: OnchainPayoutProviderStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const showSkeleton = loading && offers === null
  const showError = !loading && error !== null
  const showEmpty = !loading && error === null && offers !== null && offers.length === 0
  const hasOffers = offers !== null && offers.length > 0

  return (
    <>
      <ScreenHeader title={t('onchainPayout.providers.title')} onBack={onBack} />
      <div className="flex-1 flex flex-col px-5 overflow-y-auto">
        <p className="text-label text-foreground-muted mt-2">{t('onchainPayout.providers.subtitle')}</p>

        {showSkeleton && (
          <div className="flex flex-col gap-2 mt-4" data-testid="onchain-payout-providers-loading">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3 rounded-card bg-background-card border border-border/60 p-3">
                <Skeleton className="w-6 h-8" />
                <div className="flex-1 flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        )}

        {showError && (
          <EmptyState
            title={t('onchainPayout.providers.loadFailed')}
            description={error}
            action={{ label: t('common.retry'), onClick: onRetry }}
          />
        )}

        {showEmpty && (
          <EmptyState
            title={t('onchainPayout.providers.empty')}
            description={t('onchainPayout.providers.emptyHint')}
            action={{ label: t('common.retry'), onClick: onRetry }}
          />
        )}

        {hasOffers && !showError && (
          <>
            <div className="grid grid-cols-[1fr_auto] gap-3 px-3 mt-4 mb-1.5">
              <span className="text-caption font-medium text-foreground-muted">
                {t('onchainPayout.providers.providerId')}
              </span>
              <span className="text-caption font-medium text-foreground-muted text-right">
                {t('onchainPayout.providers.fees')}
              </span>
            </div>
            <div
              role="radiogroup"
              aria-label={t('onchainPayout.providers.title')}
              className="flex flex-col gap-2"
              data-testid="onchain-payout-providers"
            >
              {offers.map((offer) => {
                const selected = offer.offerId === selectedOfferId
                return (
                  <button
                    key={offer.offerId}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid="onchain-payout-provider-row"
                    onClick={() => onSelect(offer.offerId)}
                    className={cn(
                      'w-full flex items-center gap-3 rounded-card border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                      selected
                        ? 'border-brand bg-brand/[0.04]'
                        : 'border-border/60 bg-background-card active:bg-foreground/[0.03]',
                    )}
                  >
                    <ProviderMark identifier={offer.identifier} width={24} />
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="text-label font-medium font-mono text-foreground truncate">
                        {shortenIdentifier(offer.identifier)}
                      </span>
                      <span className="text-caption text-foreground-muted">
                        {t('onchainPayout.providers.limits', {
                          min: formatSats(offer.minAmount),
                          max: formatSats(offer.maxAmount),
                        })}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <span className="text-label font-semibold text-foreground">
                        {formatFeePercent(offer.feePercent)}
                      </span>
                      <span className="text-caption text-foreground-muted">
                        {t('onchainPayout.providers.networkFee', { amount: formatSats(offer.networkFee) })}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'w-5 h-5 rounded-full border flex items-center justify-center shrink-0',
                        selected ? 'bg-brand border-brand text-white' : 'border-border',
                      )}
                    >
                      {selected && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
      <div className="px-5 pb-app pt-3">
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!hasOffers || selectedOfferId === null || showError}
          onClick={onNext}
        >
          {t('onchainPayout.next')}
        </Button>
      </div>
    </>
  )
}
