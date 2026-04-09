/**
 * SendAmountStep — Conversational amount input step
 * "얼마를 보낼까요?" / "얼마를 만들까요?" with large centered amount
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useWallet } from '@/ui/hooks/use-wallet'
import { useAppStore } from '@/store'
import { hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useSatUnit, useFormatFiat } from '@/utils/format'
import { useFiatToggle } from '@/ui/hooks/use-fiat-toggle'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { getMintBalance } from '@/utils/url'
import { findContactName } from '../sendDisplayHelpers'
import { useContacts } from '@/ui/hooks/use-contacts'
import type { SendableValidatedData } from '../SendFlow'

interface SendAmountStepProps {
  onBack: () => void
  onNext: (data: { amount: number; memo: string; isFiatMode: boolean; fiatAmount: string }) => void
  mintUrl: string
  destination?: string
  validatedData?: SendableValidatedData
  isTokenMode: boolean
  initialAmount?: number
  initialMemo?: string
  initialFiatMode?: boolean
  initialFiatAmount?: string
  isLoading?: boolean
}

export function SendAmountStep({
  onBack,
  onNext,
  mintUrl,
  destination,
  validatedData,
  isTokenMode,
  initialAmount = 0,
  initialMemo = '',
  initialFiatMode = false,
  initialFiatAmount = '',
  isLoading = false,
}: SendAmountStepProps) {
  const { t } = useTranslation()
  const { balance } = useWallet()
  const addToast = useAppStore((s) => s.addToast)
  const formatSats = useFormatSats()
  const unit = useSatUnit()
  const toFiat = useFormatFiat()

  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [memo, setMemo] = useState(initialMemo)

  const {
    isFiatMode, fiatInput, currencySymbol, showFiat, exchangeRate,
    handleToggleFiat, handleFiatChange,
  } = useFiatToggle(amount, setAmount, { initialFiatMode, initialFiatAmount })

  const mintBalance = getMintBalance(mintUrl, balance.byMint)
  const numericAmount = parseInt(amount, 10) || 0
  const isOverBalance = numericAmount > mintBalance

  // Amount is fixed when bolt11 or cashu-request with amount
  const isAmountFixed =
    (validatedData?.type === 'bolt11' && validatedData.amountSats > 0) ||
    (validatedData?.type === 'cashu-request' && !!validatedData.parsed.amount && validatedData.parsed.amount > 0)

  // Contact name lookup (via ContactUseCase)
  const { findByAddress } = useContacts()
  const [contactName, setContactName] = useState<string | null>(null)
  useEffect(() => {
    if (!destination) return
    const addr = validatedData?.type === 'lightning-address' ? validatedData.address : destination
    findContactName(addr, findByAddress).then(setContactName)
  }, [destination, validatedData, findByAddress])

  // Destination display
  const destinationDisplay = useMemo(() => {
    if (!destination) return null
    if (contactName) return contactName
    if (validatedData?.type === 'my-wallet') return validatedData.targetMintName
    if (validatedData?.type === 'lightning-address') return validatedData.address
    if (validatedData?.type === 'lnurl-pay') return validatedData.params?.domain || 'LNURL'
    if (validatedData?.type === 'bolt11') {
      const inv = validatedData.invoice
      return `${inv.slice(0, 8)}...${inv.slice(-4)}`
    }
    if (validatedData?.type === 'cashu-request') {
      const req = validatedData.request
      return `${req.slice(0, 8)}...${req.slice(-4)}`
    }
    if (destination.length > 20) return `${destination.slice(0, 16)}...${destination.slice(-4)}`
    return destination
  }, [destination, validatedData, contactName])

  // Sub-info for destination (address detail below name)
  const destinationDetail = useMemo(() => {
    if (contactName && validatedData?.type === 'lightning-address') return validatedData.address
    return null
  }, [validatedData, contactName])

  const handleNext = useCallback(() => {
    if (!numericAmount || numericAmount <= 0) {
      addToast({ type: 'error', message: t('send.amountRequired'), duration: 3000 })
      return
    }
    if (numericAmount > mintBalance) {
      addToast({ type: 'error', message: t('payment.insufficientBalance'), duration: 3000 })
      return
    }
    hapticTap()
    onNext({ amount: numericAmount, memo, isFiatMode, fiatAmount: fiatInput })
  }, [numericAmount, mintBalance, memo, isFiatMode, fiatInput, onNext, addToast, t])

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('send.title')} onBack={onBack} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-6">
        {/* Destination label */}
        {destinationDisplay && (() => {
          // npub-contact or contact name matched: show name + detail
          if (destinationDetail) {
            return (
              <div className="mb-4">
                <p className="text-heading font-semibold">
                  <Trans i18nKey="send.confirm.recipientTo" values={{ recipient: destinationDisplay }}
                    components={{ b: <span className="text-brand" /> }} />
                </p>
                <p className="text-caption text-foreground-muted mt-0.5">
                  {destinationDetail}
                </p>
              </div>
            )
          }
          // Lightning address: user in brand + domain below
          const isLnAddress = validatedData?.type === 'lightning-address' && destinationDisplay.includes('@')
          if (isLnAddress) {
            const [user, domain] = destinationDisplay.split('@')
            return (
              <div className="mb-4">
                <p className="text-heading font-semibold">
                  <Trans i18nKey="send.confirm.recipientTo" values={{ recipient: user }}
                    components={{ b: <span className="text-brand" /> }} />
                </p>
                <p className="text-subtitle text-foreground-muted">
                  {domain}
                </p>
              </div>
            )
          }
          return (
            <p className="text-heading font-semibold truncate mb-4">
              <Trans i18nKey="send.confirm.recipientTo" values={{ recipient: destinationDisplay }}
                components={{ b: <span className="text-brand" /> }} />
            </p>
          )
        })()}

        {/* Question */}
        <h2 className="text-heading font-semibold text-foreground">
          {isTokenMode ? t('send.amount.howMuchToken') : t('send.amount.howMuchSend')}
        </h2>

        {/* Amount — underline style, consistent with address input */}
        <div className="mt-6">
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            {isFiatMode ? (
              <>
                <span className="text-title font-medium text-foreground-muted shrink-0">{currencySymbol}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fiatInput ? Number(fiatInput).toLocaleString() : ''}
                  placeholder="0"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNext() } }}
                  onChange={(e) => handleFiatChange(e.target.value)}
                  className="flex-1 min-w-0 bg-transparent py-1.5 text-title font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none"
                />
              </>
            ) : (
              <>
                {unit === '₿' && (
                  <span className="text-title font-medium text-foreground-muted shrink-0">{unit}</span>
                )}
                <input
                  type="text"
                  inputMode="numeric"
                  value={amount ? Number(amount).toLocaleString() : ''}
                  placeholder="0"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNext() } }}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, '')
                    if (Number(v) > 2_100_000_000_000_000) return
                    setAmount(v)
                  }}
                  disabled={isAmountFixed}
                  className="flex-1 min-w-0 bg-transparent py-1.5 text-title font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none disabled:opacity-60"
                />
                {unit !== '₿' && (
                  <span className="text-title font-medium text-foreground-muted shrink-0 ml-1">{unit}</span>
                )}
              </>
            )}
            {exchangeRate && showFiat && !isAmountFixed && (
              <button
                type="button"
                onClick={handleToggleFiat}
                className="flex items-center gap-1 text-body font-semibold text-brand shrink-0 ml-2 px-2.5 py-1 rounded-full bg-brand/8 active:bg-brand/15 transition-colors"
              >
                <span>{isFiatMode ? currencySymbol : unit}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 16l-4-4 4-4" /><path d="M17 8l4 4-4 4" /><line x1="3" y1="12" x2="21" y2="12" />
                </svg>
                <span>{isFiatMode ? unit : currencySymbol}</span>
              </button>
            )}
          </div>
          {/* Conversion / error — fixed height to prevent layout shift */}
          <div className="h-7 mt-1.5 flex items-center">
            {isOverBalance ? (
              <p className="text-subtitle text-accent-danger font-semibold">{t('payment.insufficientBalance')} ({t('common.balance')} {formatSats(mintBalance)})</p>
            ) : showFiat ? (
              <p className="text-subtitle text-foreground-muted">
                {isFiatMode
                  ? formatSats(numericAmount)
                  : toFiat(numericAmount) ?? `${currencySymbol}0`
                }
              </p>
            ) : null}
          </div>
        </div>

        {/* Memo — underline style, consistent */}
        <div className="mt-6">
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNext() } }}
              placeholder={t('send.amount.addMemo')}
              className="flex-1 min-w-0 bg-transparent py-1.5 text-title-sm font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Bottom button */}
      <div className="px-6 pb-6 pb-safe shrink-0">
        <Button
          variant="brand"
          size="xl"
          onClick={handleNext}
          disabled={!numericAmount || numericAmount <= 0 || isOverBalance}
          loading={isLoading}
          className="w-full"
        >
          {t('send.next')}
        </Button>
      </div>
    </div>
  )
}
