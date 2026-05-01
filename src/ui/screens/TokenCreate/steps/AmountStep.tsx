import { Button } from '@/ui/components/common/Button'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { useFiatToggle } from '@/ui/hooks/use-fiat-toggle'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useWallet } from '@/ui/hooks/use-wallet'
import { isZeroDecimalCurrency, useFormatFiat, useFormatSats, useSatUnit } from '@/utils/format'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface AmountStepProps {
  onBack: () => void
  onNext: (data: { amount: number; memo: string; senderPaysFee: boolean }) => void
  mintUrl: string
  /** Called when the user picks a different mint via the bottom sheet. */
  onChangeMint?: (mintUrl: string) => void
  initialAmount: number
  initialMemo: string
  initialSenderPaysFee: boolean
}

const KEYS_SATS: Array<string> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del']
const KEYS_FIAT: Array<string> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del']

export function AmountStep({
  onBack,
  onNext,
  mintUrl,
  onChangeMint,
  initialAmount,
  initialMemo,
  initialSenderPaysFee,
}: AmountStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const unit = useSatUnit()
  const { balance } = useWallet()
  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)

  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [memo, setMemo] = useState(initialMemo)
  const [senderPaysFee, setSenderPaysFee] = useState(initialSenderPaysFee)
  const [mintSheetOpen, setMintSheetOpen] = useState(false)
  const [memoFocused, setMemoFocused] = useState(false)

  const {
    isFiatMode,
    fiatInput,
    fiatCurrency,
    currencySymbol,
    exchangeRate,
    handleToggleFiat,
    handleFiatChange,
  } = useFiatToggle(amount, setAmount)
  const canToggleFiat = exchangeRate !== null
  const fiatIsZeroDecimal = isZeroDecimalCurrency(fiatCurrency)

  const mintBalance = balance.byMint[mintUrl] ?? 0
  const mintName = getDisplayName(mintUrl)
  const mintIconUrl = getIconUrl(mintUrl)

  const numericAmount = parseInt(amount, 10) || 0
  const insufficient = numericAmount > 0 && numericAmount > mintBalance
  const canProceed = numericAmount > 0 && !insufficient

  // Format fiat input preserving trailing dot/zeros so the keypad reflects
  // the user's literal input (e.g. "0.", "1.50") instead of Number() collapsing them.
  const formatFiatInput = (raw: string): string => {
    if (!raw) return '0'
    const [intPart, decPart] = raw.split('.')
    const intFormatted = Number(intPart || '0').toLocaleString()
    return decPart !== undefined ? `${intFormatted}.${decPart}` : intFormatted
  }

  const displayAmount = isFiatMode
    ? `${currencySymbol}${formatFiatInput(fiatInput)}`
    : formatSats(numericAmount)

  const insufficientColor = insufficient ? 'text-accent-danger' : 'text-foreground'
  const fiatLabel = !isFiatMode && numericAmount > 0 ? formatFiat(numericAmount) : null
  const satsSecondary = isFiatMode && numericAmount > 0 ? formatSats(numericAmount) : null

  const handleKey = (key: string) => {
    if (key === 'del') {
      if (isFiatMode) handleFiatChange(fiatInput.slice(0, -1))
      else setAmount((prev) => prev.slice(0, -1))
      return
    }
    if (isFiatMode) {
      if (key === '.') {
        // Block decimal input for zero-decimal currencies (JPY/KRW)
        if (fiatIsZeroDecimal) return
        if (fiatInput.includes('.')) return
        handleFiatChange(fiatInput === '' ? '0.' : fiatInput + '.')
        return
      }
      // Limit to 2 decimal digits after the dot
      const dotIdx = fiatInput.indexOf('.')
      if (dotIdx !== -1 && fiatInput.length - dotIdx - 1 >= 2) return
      const next = (fiatInput + key).replace(/^0+(?=\d)/, '')
      if (next.length > 12) return
      handleFiatChange(next)
    } else {
      setAmount((prev) => {
        const next = (prev + key).replace(/^0+(?=\d)/, '')
        if (next.length > 12) return prev
        return next
      })
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-6 pt-4 flex flex-col">
        <h2 className="text-title font-semibold text-foreground text-center">
          {t('send.tokenCreate.howMuch')}
        </h2>
        <p className="text-body text-foreground-muted text-center mt-2 whitespace-pre-line">
          {t('send.tokenCreate.amountCaption')}
        </p>

        {/* Amount hero */}
        <div className="flex flex-col items-center gap-2 mt-10">
          <p className={`text-[44px] leading-none font-semibold ${insufficientColor}`}>
            {displayAmount}
          </p>
          {canToggleFiat && (
            <button
              type="button"
              aria-label={t('send.tokenCreate.toggleUnit', { current: isFiatMode ? currencySymbol : unit })}
              onClick={handleToggleFiat}
              className="flex mt-2 items-center gap-1 text-body font-semibold text-foreground-muted shrink-0 px-2.5 py-1 rounded-full bg-background-card active:bg-background-hover transition-colors"
            >
              <span>{isFiatMode ? currencySymbol : unit}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16l-4-4 4-4" /><path d="M17 8l4 4-4 4" /><line x1="3" y1="12" x2="21" y2="12" />
              </svg>
              <span>{isFiatMode ? unit : currencySymbol}</span>
            </button>
          )}
          {insufficient ? (
            <p className="text-body text-accent-danger">
              {t('send.tokenCreate.insufficientBalance')}{' '}
              {onChangeMint ? (
                <button
                  type="button"
                  onClick={() => setMintSheetOpen(true)}
                  className="underline font-medium"
                >
                  {t('send.tokenCreate.changeMint')}
                </button>
              ) : (
                <span className="font-medium">{t('send.tokenCreate.changeMint')}</span>
              )}
            </p>
          ) : (
            <p
              className={`text-body text-foreground-muted ${
                (isFiatMode ? satsSecondary : fiatLabel) ? '' : 'invisible'
              }`}
            >
              ~ {isFiatMode ? satsSecondary ?? '0' : fiatLabel ?? '0'}
            </p>
          )}
        </div>

        {/* Mint bar — underline style */}
        <div className="flex items-center gap-3 mt-8 pb-2 border-b border-border w-[85%] mx-auto">
          <button
            type="button"
            onClick={onChangeMint ? () => setMintSheetOpen(true) : undefined}
            disabled={!onChangeMint}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
          >
            <MintIcon iconUrl={mintIconUrl} imgSize="w-7 h-7" className="w-7 h-7" circle />
            <span className="text-body font-medium text-foreground truncate">
              {mintName}
            </span>
            {onChangeMint && (
              <ChevronRight
                className="w-3.5 h-3.5 text-foreground-muted shrink-0"
                strokeWidth={2}
              />
            )}
          </button>
          <span className="text-caption text-foreground-muted">{t('common.balance')}</span>
          <span className="text-body text-foreground">{formatSats(mintBalance)}</span>
        </div>

        {/* Memo — underline style (match receive flow) */}
        <div className="mt-4 w-[85%] mx-auto">
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              onFocus={() => setMemoFocused(true)}
              onBlur={() => setMemoFocused(false)}
              placeholder={t('send.tokenCreate.memoPlaceholder')}
              maxLength={100}
              className="flex-1 min-w-0 bg-transparent py-2 text-body font-medium text-foreground placeholder:text-foreground-muted focus:outline-none"
            />
          </div>
        </div>

        {/* Fee toggle — hidden for now; state (senderPaysFee) stays wired at default `false`. */}
        <label className="hidden items-start w-[85%] mx-auto gap-2 mt-auto mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={senderPaysFee}
            onChange={(e) => setSenderPaysFee(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-brand shrink-0"
          />
          <span className="text-caption text-foreground-muted leading-snug">
            {t('send.tokenCreate.senderPaysFeeCaption')}
          </span>
        </label>
      </div>

      {/* Next button with brand rounding */}
      <div className="px-6 pb-4 shrink-0">
        <Button
          variant="brand"
          size="xl"
          disabled={!canProceed}
          onClick={() =>
            onNext({ amount: numericAmount, memo, senderPaysFee })
          }
          className="w-full"
        >
          {t('common.next')}
        </Button>
      </div>

      {/* Numpad — hidden while memo is focused so the OS keyboard takes over */}
      {!memoFocused && (
        <div className="grid grid-cols-3 gap-0 shrink-0 pb-safe">
          {(isFiatMode && !fiatIsZeroDecimal ? KEYS_FIAT : KEYS_SATS).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => handleKey(key)}
              className="h-14 text-title font-normal text-foreground hover:bg-background-hover active:bg-background-card transition-colors flex items-center justify-center"
            >
              {key === 'del' ? <ArrowLeft className="w-5 h-5" strokeWidth={1.8} /> : key}
            </button>
          ))}
        </div>
      )}

      {onChangeMint && (
        <MintSelectBottomSheet
          isOpen={mintSheetOpen}
          onClose={() => setMintSheetOpen(false)}
          onSelect={onChangeMint}
          selectedMintUrl={mintUrl}
          filterFn={(m) => (m.balance ?? 0) > 0}
        />
      )}
    </div>
  )
}
