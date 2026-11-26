import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { Button } from '@/ui/components/common/Button'
import { CountdownTimer } from '@/ui/components/common/CountdownTimer'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { ProviderMark } from '@/ui/components/payment/ProviderMark'
import { useFormatSats } from '@/utils/format'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useOnchainPayout } from '@/ui/hooks/use-onchain-payout'
import { translateError } from '@/ui/utils/error-i18n'
import { spendableByMint } from '@/store/selectors'
import type { BaseError } from '@/core/errors/base'
import type {
  OnchainPayoutOffer,
  OnchainPayoutQuoteView,
  OnchainPayoutView,
} from '@/core/ports/driving/onchain-payout.usecase'
import { OnchainPayoutProgressView } from './OnchainPayoutProgress'
import { OnchainPayoutProviderStep } from './OnchainPayoutProviderStep'
import { OnchainPayoutAmountStep } from './OnchainPayoutAmountStep'
import { shortenIdentifier, type PayoutFormValues } from './payout-form'
import {
  isOnchainPayoutTerminalStage,
  onchainPayoutStageLabel,
} from '@/ui/utils/onchain-payout-labels'

type FlowStep = 'provider' | 'amount' | 'confirm' | 'progress'

export interface OnchainPayoutFlowProps {
  address?: string
  amountSats?: number
  onClose: () => void
}

function shorten(value: string): string {
  if (value.length <= 20) return value
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

export function OnchainPayoutFlow({ address, amountSats, onClose }: OnchainPayoutFlowProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const settings = useAppStore((state) => state.settings)
  const balance = useAppStore((state) => state.balance)
  const inFlight = useAppStore((state) => state.onchainPayoutInFlightByMint ?? {})
  const addToast = useAppStore((state) => state.addToast)
  const payouts = useAppStore((state) => state.onchainPayouts ?? [])
  const { listOffers, quote: quotePayout, start: startPayout, get } = useOnchainPayout()
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)

  const spendable = useMemo(
    () => spendableByMint(balance.byMint, inFlight),
    [balance.byMint, inFlight],
  )
  const mintUrls = useMemo(
    () => settings.mints.filter((mintUrl) => (spendable[mintUrl] ?? 0) > 0),
    [settings.mints, spendable],
  )

  const [step, setStep] = useState<FlowStep>('provider')
  const [offers, setOffers] = useState<OnchainPayoutOffer[] | null>(null)
  const [offersLoading, setOffersLoading] = useState(true)
  const [offersError, setOffersError] = useState<BaseError | null>(null)
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<PayoutFormValues>(() => ({
    amountText: amountSats && amountSats > 0 ? String(amountSats) : '',
    amountSide: 'send',
    address: address ?? '',
  }))
  const [mintUrl, setMintUrl] = useState<string | null>(mintUrls[0] ?? settings.mints[0] ?? null)
  const [mintSheetOpen, setMintSheetOpen] = useState(false)
  const [quoteRequest, setQuoteRequest] = useState<{ sendAmount: number; destination: string } | null>(null)
  const [quote, setQuote] = useState<OnchainPayoutQuoteView | null>(null)
  const [payout, setPayout] = useState<OnchainPayoutView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [quoteExpired, setQuoteExpired] = useState(false)
  const startLockRef = useRef(false)
  const offersEpochRef = useRef(0)
  const quoteEpochRef = useRef(0)

  const selectedBalance = mintUrl ? spendable[mintUrl] ?? 0 : 0
  const selectedOffer = offers?.find((offer) => offer.offerId === selectedOfferId) ?? null

  const fetchOffers = useCallback(async () => {
    const epoch = ++offersEpochRef.current
    const result = await listOffers()
    if (epoch !== offersEpochRef.current) return
    setOffersLoading(false)
    if (!result.ok) {
      setOffersError(result.error)
      return
    }
    const next = result.value
    setOffersError(null)
    setOffers(next)
    setSelectedOfferId((current) =>
      current !== null && next.some((offer) => offer.offerId === current)
        ? current
        : next[0]?.offerId ?? null,
    )
  }, [listOffers])

  useEffect(() => {
    void fetchOffers()
  }, [fetchOffers])

  const handleRetryOffers = useCallback(() => {
    setOffersLoading(true)
    setOffersError(null)
    void fetchOffers()
  }, [fetchOffers])

  const requestQuote = useCallback(
    async (request: { sendAmount: number; destination: string }) => {
      if (!mintUrl || !selectedOfferId || startLockRef.current) return
      const epoch = ++quoteEpochRef.current
      setQuoteRequest(request)
      setQuoting(true)
      setError(null)
      const result = await quotePayout({
        offerId: selectedOfferId,
        sendAmount: request.sendAmount,
        destination: request.destination,
        mintUrl,
      })
      if (epoch !== quoteEpochRef.current) return
      setQuoting(false)
      if (startLockRef.current) return
      if (!result.ok) {
        const cause = result.error
        if ('minAmount' in cause && 'maxAmount' in cause) {
          setError(
            t('onchainPayout.outOfRange', {
              min: formatSats(Number(cause.minAmount)),
              max: formatSats(Number(cause.maxAmount)),
            }),
          )
        } else {
          setError(translateError(cause, t))
        }
        return
      }
      setQuote(result.value)
      setQuoteExpired(false)
      setStep('confirm')
    },
    [mintUrl, selectedOfferId, quotePayout, t, formatSats],
  )

  const handleRequote = useCallback(() => {
    if (quoteRequest) void requestQuote(quoteRequest)
  }, [quoteRequest, requestQuote])

  const handleConfirm = useCallback(async () => {
    if (!quote || !mintUrl || startLockRef.current || quoteExpired) return
    startLockRef.current = true
    setStarting(true)
    setError(null)
    try {
      const result = await startPayout({ quoteId: quote.quoteId, mintUrl })
      if (!result.ok) {
        setError(translateError(result.error, t))
        return
      }
      setPayout(result.value)
      setStep('progress')
    } finally {
      startLockRef.current = false
      setStarting(false)
    }
  }, [quote, mintUrl, quoteExpired, startPayout, t])

  const handleQuoteExpired = useCallback(() => setQuoteExpired(true), [])

  const invalidatePendingQuote = useCallback(() => {
    quoteEpochRef.current += 1
    setQuoting(false)
  }, [])

  const handleConfirmBack = useCallback(() => {
    if (startLockRef.current) return
    invalidatePendingQuote()
    setError(null)
    setStep('amount')
  }, [invalidatePendingQuote])

  const livePayout = payout
    ? payouts.find((candidate) => candidate.id === payout.id) ?? payout
    : null

  useEffect(() => {
    if (!payout || isOnchainPayoutTerminalStage(payout.stage)) return
    const timer = setInterval(() => {
      void get(payout.id).then((latest) => {
        if (latest) setPayout(latest)
      })
    }, 3000)
    return () => clearInterval(timer)
  }, [payout, get])

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col" data-testid="onchain-payout-flow">
      {step === 'provider' && (
        <OnchainPayoutProviderStep
          offers={offers}
          loading={offersLoading}
          error={offersError ? translateError(offersError, t) : null}
          selectedOfferId={selectedOfferId}
          onSelect={setSelectedOfferId}
          onRetry={handleRetryOffers}
          onNext={() => {
            setError(null)
            setStep('amount')
          }}
          onBack={onClose}
        />
      )}

      {step === 'amount' && selectedOffer && (
        <>
          <OnchainPayoutAmountStep
            offer={selectedOffer}
            values={formValues}
            onChange={(values) => {
              setError(null)
              setFormValues(values)
            }}
            mintUrl={mintUrl}
            mintName={mintUrl ? getDisplayName(mintUrl) : null}
            mintIconUrl={mintUrl ? getIconUrl(mintUrl) ?? null : null}
            spendable={selectedBalance}
            onOpenMintSelect={() => setMintSheetOpen(true)}
            quoting={quoting}
            error={error}
            onQuote={(request) => void requestQuote(request)}
            onBack={() => {
              invalidatePendingQuote()
              setError(null)
              setStep('provider')
            }}
          />
          <MintSelectBottomSheet
            isOpen={mintSheetOpen}
            onClose={() => setMintSheetOpen(false)}
            onSelect={(url) => {
              setMintUrl(url)
              setMintSheetOpen(false)
            }}
            selectedMintUrl={mintUrl}
            mintUrls={mintUrls}
            getShortage={() => 0}
          />
        </>
      )}

      {step === 'confirm' && quote && (
        <>
          <ScreenHeader title={t('onchainPayout.confirm')} onBack={handleConfirmBack} />
          <div className="flex-1 flex flex-col px-5 overflow-y-auto">
            <div className="flex flex-col gap-3 py-4">
              <div className="flex items-center justify-between gap-3" data-testid="onchain-payout-confirm-provider">
                <span className="text-label text-foreground-muted">{t('onchainPayout.providers.provider')}</span>
                <span className="flex items-center gap-2 min-w-0">
                  <ProviderMark identifier={quote.identifier} width={24} />
                  <span className="text-label font-medium font-mono text-foreground truncate">
                    {shortenIdentifier(quote.identifier)}
                  </span>
                </span>
              </div>
              <Row label={t('onchainPayout.destination')} value={shorten(quote.destination)} mono />
              <Row label={t('onchainPayout.youReceive')} value={formatSats(quote.receiveAmount)} strong />
              <Row label={t('onchainPayout.serviceFee')} value={formatSats(quote.serviceFee)} />
              <Row label={t('onchainPayout.networkFee')} value={formatSats(quote.networkFee)} />
              <Row label={t('onchainPayout.payoutFee')} value={formatSats(quote.sweepFee)} />
              <Row label={t('onchainPayout.totalSent')} value={formatSats(quote.sendAmount)} />
              <Row
                label={t('onchainPayout.estimatedTime')}
                value={t('onchainPayout.minutes', { count: quote.estimatedMinutes })}
              />
            </div>
            <p className="text-caption text-foreground-muted leading-relaxed">
              {t('onchainPayout.notice')}
            </p>
            {!quoteExpired && (
              <CountdownTimer key={quote.quoteId} expiryMs={quote.expiresAt} onExpired={handleQuoteExpired}>
                {(remaining) => (
                  <span className="text-caption text-foreground-muted mt-3">
                    {t('onchainPayout.quoteExpires', { seconds: remaining })}
                  </span>
                )}
              </CountdownTimer>
            )}
            {error && (
              <span className="text-label text-accent-danger mt-2" data-testid="onchain-payout-error">
                {error}
              </span>
            )}
          </div>
          <div className="px-5 pb-app pt-3 flex flex-col gap-2">
            {(!quoteExpired || starting) && (
              <Button variant="primary" size="lg" loading={starting} disabled={starting || quoting} onClick={handleConfirm}>
                {t('onchainPayout.confirmPay')}
              </Button>
            )}
            <Button
              variant={quoteExpired && !starting ? 'primary' : 'ghost'}
              loading={quoting}
              disabled={starting || quoting}
              onClick={handleRequote}
            >
              {t('onchainPayout.requote')}
            </Button>
          </div>
        </>
      )}

      {step === 'progress' && livePayout && (
        <>
          <ScreenHeader title={onchainPayoutStageLabel(livePayout.stage, t)} onBack={onClose} />
          <div className="flex-1 px-5 overflow-y-auto">
            <OnchainPayoutProgressView
              payout={livePayout}
              onClose={() => {
                addToast({ type: 'info', message: t('onchainPayout.pendingTitle'), duration: 2000 })
                onClose()
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string
  value: string
  strong?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-label text-foreground-muted">{label}</span>
      <span
        className={[
          'text-label text-right break-all',
          strong ? 'text-body font-semibold text-foreground' : 'font-medium text-foreground',
          mono ? 'font-mono' : '',
        ].join(' ')}
      >
        {value}
      </span>
    </div>
  )
}

export type { OnchainPayoutView }
