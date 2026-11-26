import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { Button } from '@/ui/components/common/Button'
import { NumericKeypad } from '@/ui/components/common/NumericKeypad'
import { CountdownTimer } from '@/ui/components/common/CountdownTimer'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { useFormatSats } from '@/utils/format'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useOnchainPayout } from '@/ui/hooks/use-onchain-payout'
import { translateError } from '@/ui/utils/error-i18n'
import { spendableByMint } from '@/store/selectors'
import type { OnchainPayoutQuoteView, OnchainPayoutView } from '@/core/ports/driving/onchain-payout.usecase'
import { OnchainPayoutProgressView } from './OnchainPayoutProgress'
import {
  isOnchainPayoutTerminalStage,
  onchainPayoutStageLabel,
} from '@/ui/utils/onchain-payout-labels'

const MIN_AMOUNT = 20000

type FlowStep = 'amount' | 'confirm' | 'progress'

export interface OnchainPayoutFlowProps {
  address: string
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
  const { quote: quotePayout, start: startPayout, get } = useOnchainPayout()
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)

  const spendable = useMemo(
    () => spendableByMint(balance.byMint, inFlight),
    [balance.byMint, inFlight],
  )
  const mintUrls = useMemo(
    () => settings.mints.filter((mintUrl) => (spendable[mintUrl] ?? 0) > 0),
    [settings.mints, spendable],
  )

  const [step, setStep] = useState<FlowStep>('amount')
  const [amount, setAmount] = useState(() => (amountSats && amountSats > 0 ? String(amountSats) : ''))
  const [mintUrl, setMintUrl] = useState<string | null>(mintUrls[0] ?? settings.mints[0] ?? null)
  const [mintSheetOpen, setMintSheetOpen] = useState(false)
  const [quote, setQuote] = useState<OnchainPayoutQuoteView | null>(null)
  const [payout, setPayout] = useState<OnchainPayoutView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [quoteExpired, setQuoteExpired] = useState(false)
  const startLockRef = useRef(false)

  const numericAmount = Number(amount || '0')
  const selectedBalance = mintUrl ? spendable[mintUrl] ?? 0 : 0
  const amountTooHigh = numericAmount > selectedBalance

  const handleKey = useCallback((key: string) => {
    setError(null)
    setAmount((previous) => {
      if (key === 'delete') return previous.slice(0, -1)
      if (previous.length >= 9) return previous
      if (key === '0' && previous === '') return previous
      return `${previous}${key}`
    })
  }, [])

  const requestQuote = useCallback(async () => {
    if (!mintUrl || startLockRef.current) return
    setQuoting(true)
    setError(null)
    const result = await quotePayout({
      sendAmount: numericAmount,
      destination: address,
      mintUrl,
    })
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
  }, [mintUrl, numericAmount, address, quotePayout, t, formatSats])

  const handleAmountNext = useCallback(async () => {
    if (numericAmount < MIN_AMOUNT) {
      setError(t('onchainPayout.minAmount', { amount: formatSats(MIN_AMOUNT) }))
      return
    }
    if (!Number.isSafeInteger(numericAmount) || amountTooHigh) {
      setError(t('onchainPayout.insufficientBalance'))
      return
    }
    await requestQuote()
  }, [numericAmount, amountTooHigh, requestQuote, t, formatSats])

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

  const handleConfirmBack = useCallback(() => {
    if (startLockRef.current) return
    setStep('amount')
  }, [])

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
      {step === 'amount' && (
        <>
          <ScreenHeader title={t('onchainPayout.title')} onBack={onClose} />
          <div className="flex-1 flex flex-col px-5">
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              <span className="text-caption text-foreground-muted">
                {t('onchainPayout.amountToSend')}
              </span>
              <span className="text-display font-bold text-foreground">
                {formatSats(numericAmount)}
              </span>
              <span className="text-label text-foreground-muted">
                {t('onchainPayout.destination')} · {shorten(address)}
              </span>
              {error && (
                <span className="text-label text-accent-danger text-center" data-testid="onchain-payout-error">
                  {error}
                </span>
              )}
              <button
                type="button"
                onClick={() => setMintSheetOpen(true)}
                className="mt-3 flex items-center gap-2 rounded-xl bg-foreground/[0.04] px-3 py-2"
              >
                {mintUrl && <img src={getIconUrl(mintUrl)} alt="" className="w-5 h-5 rounded-full" />}
                <span className="text-label font-medium text-foreground">
                  {mintUrl ? getDisplayName(mintUrl) : t('onchainPayout.selectMint')}
                </span>
                <span className="text-label text-foreground-muted">{formatSats(selectedBalance)}</span>
                <ChevronRight className="w-4 h-4 text-foreground-muted" />
              </button>
              <span className="text-caption text-foreground-muted mt-2 text-center">
                {t('onchainPayout.minAmount', { amount: formatSats(MIN_AMOUNT) })}
              </span>
            </div>
            <Button
              variant="primary"
              size="lg"
              loading={quoting}
              disabled={numericAmount <= 0 || quoting}
              onClick={handleAmountNext}
              className="mb-3"
            >
              {t('common.confirm')}
            </Button>
            <NumericKeypad onKeyPress={handleKey} deleteAriaLabel={t('common.delete')} />
          </div>
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
              <Row label={t('onchainPayout.destination')} value={shorten(address)} mono />
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
              onClick={requestQuote}
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
