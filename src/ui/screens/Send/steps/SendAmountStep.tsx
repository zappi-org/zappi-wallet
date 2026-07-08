/**
 * SendAmountStep — Amount entry with a numeric keypad.
 * The recipient picked on the previous step rides up here as a collapsed
 * "받는 사람 / name" header (or "직접 전달" for the bearer-token branch);
 * the amount hero + keypad take the stage. Tapping the header returns to edit.
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { useWallet } from '@/ui/hooks/use-wallet'
import { useAppStore } from '@/store'
import { hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useSatUnit, useFormatFiat, isZeroDecimalCurrency } from '@/utils/format'
import { useFiatToggle } from '@/ui/hooks/use-fiat-toggle'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { getMintBalance } from '@/utils/url'
import {
  findContactName,
  formatNpubShort,
  formatRecipientDisplayText,
  shouldShowRecipientInMainMessage,
} from '../sendDisplayHelpers'
import { useContacts } from '@/ui/hooks/use-contacts'
import type { SendableValidatedData } from '../SendFlow'

const KEYS_SATS: Array<string> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del']
const KEYS_FIAT: Array<string> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del']

interface SendAmountStepProps {
  onBack: () => void
  onNext: (data: { amount: number; memo: string; isFiatMode: boolean; fiatAmount: string }) => void
  mintUrl: string
  destination?: string
  validatedData?: SendableValidatedData
  initialAmount?: number
  initialMemo?: string
  initialFiatMode?: boolean
  initialFiatAmount?: string
  isLoading?: boolean
  /** Display name from address book (overrides default recipient display) */
  displayName?: string
  /** Bearer-token branch: show a plain "직접 전달" label instead of a recipient. */
  directTransfer?: boolean
  /** When provided, the mint bar becomes tappable to change the source mint. */
  onChangeMint?: (mintUrl: string) => void
}

export function SendAmountStep({
  onBack,
  onNext,
  mintUrl,
  destination,
  validatedData,
  initialAmount = 0,
  initialMemo = '',
  initialFiatMode = false,
  initialFiatAmount = '',
  isLoading = false,
  displayName,
  directTransfer = false,
  onChangeMint,
}: SendAmountStepProps) {
  const { t } = useTranslation()
  const { balance } = useWallet()
  const addToast = useAppStore((s) => s.addToast)
  const formatSats = useFormatSats()
  const unit = useSatUnit()
  const toFiat = useFormatFiat()
  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)

  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [memo, setMemo] = useState(initialMemo)
  const [memoFocused, setMemoFocused] = useState(false)
  const [mintSheetOpen, setMintSheetOpen] = useState(false)

  const {
    isFiatMode, fiatInput, fiatCurrency, currencySymbol, exchangeRate,
    handleToggleFiat, handleFiatChange,
  } = useFiatToggle(amount, setAmount, { initialFiatMode, initialFiatAmount })
  const canToggleFiat = exchangeRate !== null
  const fiatIsZeroDecimal = isZeroDecimalCurrency(fiatCurrency)

  const mintBalance = getMintBalance(mintUrl, balance.byMint)
  const mintName = getDisplayName(mintUrl)
  const mintIconUrl = getIconUrl(mintUrl)
  const numericAmount = parseInt(amount, 10) || 0
  const isOverBalance = numericAmount > mintBalance

  // Amount is fixed when bolt11 or cashu-request carries an amount → hide keypad.
  const isAmountFixed =
    (validatedData?.type === 'bolt11' && validatedData.amountSats > 0) ||
    (validatedData?.type === 'cashu-request' && !!validatedData.parsed.amount && validatedData.parsed.amount > 0)

  // Contact name lookup (via ContactUseCase)
  const { findByAddress } = useContacts()
  const [contactName, setContactName] = useState<string | null>(null)
  useEffect(() => {
    if (!destination || directTransfer) return
    let addr: string
    if (validatedData?.type === 'lightning-address') {
      addr = validatedData.address
    } else if (validatedData?.type === 'cashu-request') {
      addr = validatedData.request
    } else {
      addr = destination
    }
    findContactName(addr, findByAddress).then(setContactName)
  }, [destination, validatedData, findByAddress, directTransfer])

  // Collapsed recipient label (name)
  const recipientLabel = useMemo(() => {
    if (validatedData && !shouldShowRecipientInMainMessage(validatedData)) return null
    if (!destination && !displayName) return null
    if (displayName) return formatRecipientDisplayText(displayName)
    if (contactName) return formatRecipientDisplayText(contactName)
    if (validatedData?.type === 'my-wallet') return formatRecipientDisplayText(validatedData.targetMintName)
    if (validatedData?.type === 'lightning-address') return validatedData.address
    if (validatedData?.type === 'lnurl-pay') return validatedData.params?.domain || 'LNURL'
    if (validatedData?.type === 'bolt11') {
      const inv = validatedData.invoice
      return `${inv.slice(0, 8)}...${inv.slice(-4)}`
    }
    if (validatedData?.type === 'cashu-request') return formatRecipientDisplayText(validatedData.request)
    return destination ? formatRecipientDisplayText(destination) : null
  }, [destination, validatedData, contactName, displayName])

  // Secondary line under the recipient (e.g. npub / ln-address detail)
  const recipientDetail = useMemo(() => {
    if (validatedData && !shouldShowRecipientInMainMessage(validatedData)) return null
    if (contactName && validatedData?.type === 'lightning-address') return validatedData.address
    if (displayName && validatedData?.type === 'cashu-request') return formatNpubShort(validatedData.request)
    return null
  }, [validatedData, contactName, displayName])

  const handleKey = (key: string) => {
    if (isAmountFixed) return
    if (key === 'del') {
      if (isFiatMode) handleFiatChange(fiatInput.slice(0, -1))
      else setAmount((prev) => prev.slice(0, -1))
      return
    }
    if (isFiatMode) {
      if (key === '.') {
        if (fiatIsZeroDecimal) return
        if (fiatInput.includes('.')) return
        handleFiatChange(fiatInput === '' ? '0.' : fiatInput + '.')
        return
      }
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

  const displayAmount = isFiatMode
    ? `${currencySymbol}${fiatInput ? Number(fiatInput).toLocaleString() : '0'}`
    : formatSats(numericAmount)
  const fiatLabel = !isFiatMode && numericAmount > 0 ? toFiat(numericAmount) : null
  const satsSecondary = isFiatMode && numericAmount > 0 ? formatSats(numericAmount) : null

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('send.title')} onBack={onBack} />

      {/* Collapsed recipient / direct-transfer label — tap to re-edit */}
      {(directTransfer || recipientLabel) && (
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 px-6 pt-1 pb-1 flex flex-col items-center gap-0.5 w-full active:opacity-70 transition-opacity"
        >
          {directTransfer ? (
            <span className="text-subtitle font-semibold text-foreground">{t('send.direct.label')}</span>
          ) : (
            <>
              <span className="text-label uppercase tracking-wider text-foreground-muted">
                {t('send.confirm.recipient')}
              </span>
              <span className="text-subtitle font-semibold text-foreground truncate max-w-[280px]">
                {recipientLabel}
              </span>
              {recipientDetail && (
                <span className="text-caption text-foreground-muted truncate max-w-[280px]">{recipientDetail}</span>
              )}
            </>
          )}
        </button>
      )}

      <div className="flex-1 overflow-y-auto px-6 flex flex-col">
        {/* Amount hero */}
        <div className="flex flex-col items-center gap-2 mt-8">
          <p className={`text-[44px] leading-none font-semibold ${isOverBalance ? 'text-accent-danger' : 'text-foreground'}`}>
            {displayAmount}
          </p>
          {canToggleFiat && !isAmountFixed && (
            <button
              type="button"
              aria-label={t('send.tokenCreate.toggleUnit', { current: isFiatMode ? currencySymbol : unit })}
              onClick={handleToggleFiat}
              className="flex mt-1 items-center gap-1 text-body font-semibold text-foreground-muted shrink-0 px-2.5 py-1 rounded-full bg-background-card active:bg-background-hover transition-colors"
            >
              <span>{isFiatMode ? currencySymbol : unit}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16l-4-4 4-4" /><path d="M17 8l4 4-4 4" /><line x1="3" y1="12" x2="21" y2="12" />
              </svg>
              <span>{isFiatMode ? unit : currencySymbol}</span>
            </button>
          )}
          {isOverBalance ? (
            <p className="text-body text-accent-danger">
              {t('payment.insufficientBalance')} ({t('common.balance')} {formatSats(mintBalance)})
            </p>
          ) : (
            <p className={`text-body text-foreground-muted ${(isFiatMode ? satsSecondary : fiatLabel) ? '' : 'invisible'}`}>
              ~ {isFiatMode ? satsSecondary ?? '0' : fiatLabel ?? '0'}
            </p>
          )}
        </div>

        {/* Mint bar — logo + custom name + balance (tappable when onChangeMint) */}
        <div className="flex items-center gap-3 mt-8 pb-2 border-b border-border w-[85%] mx-auto">
          <button
            type="button"
            onClick={onChangeMint ? () => setMintSheetOpen(true) : undefined}
            disabled={!onChangeMint}
            className="flex items-center gap-2 flex-1 min-w-0 text-left"
          >
            <MintIcon iconUrl={mintIconUrl} imgSize="w-7 h-7" className="w-7 h-7" circle />
            <span className="text-body font-medium text-foreground truncate">{mintName}</span>
            {onChangeMint && <ChevronRight className="w-3.5 h-3.5 text-foreground-muted shrink-0" strokeWidth={2} />}
          </button>
          <span className="text-caption text-foreground-muted">{t('common.balance')}</span>
          <span className="text-body text-foreground">{formatSats(mintBalance)}</span>
        </div>

        {/* Memo — underline style */}
        <div className="mt-4 w-[85%] mx-auto">
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              onFocus={() => setMemoFocused(true)}
              onBlur={() => setMemoFocused(false)}
              placeholder={t('send.amount.addMemo')}
              maxLength={100}
              className="flex-1 min-w-0 bg-transparent py-2 text-body font-medium text-foreground placeholder:text-foreground-muted focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Next button */}
      <div className="px-6 pb-4 shrink-0">
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

      {/* Numpad — hidden when the amount is fixed (invoice) or the memo is focused */}
      {!isAmountFixed && !memoFocused && (
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
          onSelect={(url) => { onChangeMint(url); setMintSheetOpen(false) }}
          selectedMintUrl={mintUrl}
          filterFn={(m) => (m.balance ?? 0) > 0}
        />
      )}
    </div>
  )
}
