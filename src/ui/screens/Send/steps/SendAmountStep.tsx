/**
 * SendAmountStep — Amount entry with a numeric keypad.
 * The recipient picked on the previous step rides up here as a collapsed
 * "TO name" header (or "직접 전달" for the bearer-token branch); the amount
 * hero + keypad take the stage. Tapping the header returns to edit.
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ArrowLeft, ChevronDown, ArrowUpDown, Lock } from 'lucide-react'
import { useWallet } from '@/ui/hooks/use-wallet'
import { useAppStore } from '@/store'
import { hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useSatUnit, useFormatFiat, isZeroDecimalCurrency, formatFiatInputForDisplay } from '@/utils/format'
import { useFiatToggle } from '@/ui/hooks/use-fiat-toggle'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { getMintBalance } from '@/utils/url'
import { findContactName, formatNpubShort, formatRecipientDisplayText } from '../sendDisplayHelpers'
import { useContacts } from '@/ui/hooks/use-contacts'
import type { SendableValidatedData, MaxAmountResult } from '../SendFlow'
import { SEND_RECIPIENT_LAYOUT_ID, recipientMorphTransition } from '../sendMorph'
import { fadeTransition } from '@/ui/utils/motion'

const KEYS_SATS: Array<string> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'max', '0', 'del']
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
  /** Resolves a fee-aware maximum that is safe to send from this mint. */
  onResolveMaxAmount?: (mintUrl: string, balance: number) => Promise<MaxAmountResult>
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
  onResolveMaxAmount,
}: SendAmountStepProps) {
  const { t } = useTranslation()
  const { balance } = useWallet()
  const addToast = useAppStore((s) => s.addToast)
  const formatSats = useFormatSats()
  const unit = useSatUnit()
  const toFiat = useFormatFiat()
  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)
  const reduceMotion = useReducedMotion()

  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [mintSheetOpen, setMintSheetOpen] = useState(false)
  const [isResolvingMax, setIsResolvingMax] = useState(false)
  const memo = initialMemo

  const {
    isFiatMode,
    fiatInput,
    fiatCurrency,
    currencySymbol,
    exchangeRate,
    showFiat,
    handleToggleFiat,
    handleFiatChange,
    syncFiatFromSats,
  } = useFiatToggle(amount, setAmount, { initialFiatMode, initialFiatAmount })
  const canToggleFiat = exchangeRate !== null && showFiat
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

  // Collapsed recipient label (the "TO {name}" eyebrow value)
  const recipientLabel = useMemo(() => {
    if (!validatedData && !destination && !displayName) return null
    if (displayName) return formatRecipientDisplayText(displayName)
    if (contactName) return formatRecipientDisplayText(contactName)
    if (validatedData?.type === 'my-wallet') return formatRecipientDisplayText(validatedData.targetMintName)
    if (validatedData?.type === 'lightning-address') return validatedData.address
    if (validatedData?.type === 'lnurl-pay') return validatedData.params?.domain || 'LNURL'
    if (validatedData?.type === 'bolt11') return t('send.confirm.lightningInvoice')
    if (validatedData?.type === 'cashu-request') return formatRecipientDisplayText(validatedData.request)
    return destination ? formatRecipientDisplayText(destination) : null
  }, [destination, validatedData, contactName, displayName, t])

  // Secondary line under the recipient (identifier: address / invoice / npub)
  const recipientDetail = useMemo(() => {
    // Only fill the second line with the identifier when the eyebrow carries a
    // REAL name (contact). A directly-typed npub/address gets just "TO" + value.
    if (contactName && validatedData?.type === 'lightning-address') return validatedData.address
    if (contactName && validatedData?.type === 'cashu-request') return formatNpubShort(validatedData.request)
    if (validatedData?.type === 'bolt11') {
      const inv = validatedData.invoice
      return `${inv.slice(0, 8)}...${inv.slice(-4)}`
    }
    return null
  }, [validatedData, contactName])

  const handleKey = async (key: string) => {
    if (isAmountFixed) return
    if (key === 'max') {
      if (isResolvingMax) return
      setIsResolvingMax(true)
      try {
        const result: MaxAmountResult = onResolveMaxAmount
          ? await onResolveMaxAmount(mintUrl, mintBalance)
          : { status: 'ok', amount: mintBalance }
        if (result.status === 'error') {
          // Resolver toasts on the route-selection path; only surface here if it did not.
          if (!result.reported) {
            addToast({ type: 'error', message: t('send.confirm.feeUnavailable'), duration: 3000 })
          }
          return
        }

        const safeAmount = Math.max(0, Math.min(mintBalance, Math.floor(result.amount)))
        setAmount(safeAmount > 0 ? String(safeAmount) : '')
        if (isFiatMode) syncFiatFromSats(safeAmount)
      } finally {
        setIsResolvingMax(false)
      }
      return
    }
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
      addToast({
        type: 'error',
        message: t('send.amountRequired'),
        duration: 3000,
      })
      return
    }
    if (numericAmount > mintBalance) {
      addToast({
        type: 'error',
        message: t('payment.insufficientBalance'),
        duration: 3000,
      })
      return
    }
    hapticTap()
    onNext({ amount: numericAmount, memo, isFiatMode, fiatAmount: fiatInput })
  }, [numericAmount, mintBalance, memo, isFiatMode, fiatInput, onNext, addToast, t])

  const displayAmount = isFiatMode
    ? `${currencySymbol}${formatFiatInputForDisplay(fiatInput)}`
    : formatSats(numericAmount)
  // Secondary conversion line (shown with the ⇄ toggle) — always visible.
  const secondary = isFiatMode ? formatSats(numericAmount) : toFiat(numericAmount) ?? `${currencySymbol}0`

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title={t('send.title')} onBack={onBack} />

      {/* Collapsed recipient / direct-transfer label — tap to re-edit.
          Plain text per mockup (docs/sample/send_sample.png); layoutId pairs it
          with the leaving input text in SendInputStep so only the TEXT morphs
          between scenes. Tap feedback via scale — motion owns inline opacity. */}
      {(directTransfer || recipientLabel) && (
        <motion.button
          type="button"
          layoutId={SEND_RECIPIENT_LAYOUT_ID}
          // Explicit opacity overrides motion's auto-crossfade, which freezes
          // the incoming element semi-transparent for the whole flight —
          // the text must stay solid while it glides
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ ...recipientMorphTransition(reduceMotion), opacity: { duration: 0.15, ease: 'easeOut' } }}
          whileTap={{ scale: 0.96 }}
          onClick={onBack}
          className="shrink-0 mt-3 mx-auto px-4 py-2 flex flex-col items-center gap-0.5 max-w-[calc(100%-3rem)]"
        >
          {directTransfer ? (
            <span className="text-subtitle font-semibold text-foreground">{t('send.direct.label')}</span>
          ) : (
            <>
              <span className="text-label uppercase tracking-wider text-foreground-muted">
                {recipientDetail ? `TO ${recipientLabel}` : 'TO'}
              </span>
              <span className="text-subtitle font-semibold text-foreground truncate max-w-[280px]">
                {recipientDetail ?? recipientLabel}
              </span>
            </>
          )}
        </motion.button>
      )}

      {/* Scene content fades here (not on the SendFlow scene wrapper) so the
          layoutId recipient text above is never dimmed by an animating ancestor */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, pointerEvents: 'none' }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="flex-1 min-h-0 flex flex-col"
      >
      <div className="flex-1 overflow-y-auto px-6 flex flex-col">
        {/* Amount hero — tap anywhere in this area to toggle sats/fiat, with a swap animation */}
        <button
          type="button"
          onClick={canToggleFiat && !isAmountFixed ? handleToggleFiat : undefined}
          disabled={!canToggleFiat || isAmountFixed}
          aria-label={t('send.tokenCreate.toggleUnit', {
            current: isFiatMode ? currencySymbol : unit,
          })}
          className="flex-1 flex flex-col items-center justify-center gap-2 w-full disabled:cursor-default"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={isFiatMode ? 'fiat' : 'sats'}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : -10 }}
              transition={fadeTransition(reduceMotion, 0.18)}
              className={`text-[54px] leading-none font-light tracking-tight ${
                isOverBalance ? 'text-accent-danger' : 'text-foreground'
              }`}
            >
              {displayAmount}
            </motion.span>
          </AnimatePresence>
          {/* Conversion line honors the Preferences fiat toggle (parity with Receive) */}
          {(showFiat || isFiatMode) && (
            <span className="flex items-center gap-1.5 text-body text-foreground-muted">
              <span>{secondary}</span>
              {canToggleFiat && !isAmountFixed && <ArrowUpDown className="w-3.5 h-3.5" strokeWidth={2.2} />}
            </span>
          )}
          {isAmountFixed && (
            <span className="flex items-center gap-1 text-caption text-foreground-muted mt-1">
              <Lock className="w-3 h-3" strokeWidth={2} />
              {t('send.amount.fixedByInvoice')}
            </span>
          )}
          {isOverBalance && (
            <span className="text-caption text-accent-danger">
              {t('payment.insufficientBalance')} ({t('common.balance')} {formatSats(mintBalance)})
            </span>
          )}
        </button>

        {/* Mint — logo + custom name, centered (tappable when onChangeMint) */}
        <button
          type="button"
          onClick={onChangeMint ? () => setMintSheetOpen(true) : undefined}
          disabled={!onChangeMint}
          className="flex items-center justify-center gap-2 mb-3 mx-auto"
        >
          <MintIcon iconUrl={mintIconUrl} imgSize="w-6 h-6" className="w-6 h-6" circle />
          <span className="text-body font-medium text-foreground truncate max-w-[220px]">{mintName}</span>
          {onChangeMint && <ChevronDown className="w-4 h-4 text-foreground-muted shrink-0" strokeWidth={2} />}
        </button>
      </div>

      {/* Numpad — dimmed (not hidden) when the amount is fixed by an invoice */}
      <div className={`grid grid-cols-3 gap-0 shrink-0 ${isAmountFixed ? 'opacity-30 pointer-events-none' : ''}`}>
        {(isFiatMode && !fiatIsZeroDecimal ? KEYS_FIAT : KEYS_SATS).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => void handleKey(key)}
            disabled={key === 'max' && isResolvingMax}
            className="h-14 text-title font-normal text-foreground hover:bg-background-hover active:bg-background-card transition-colors flex items-center justify-center"
          >
            {key === 'del' ? (
              <ArrowLeft className="w-5 h-5" strokeWidth={1.8} />
            ) : key === 'max' ? (
              <span className="text-body font-semibold text-foreground-muted">{t('send.max')}</span>
            ) : (
              key
            )}
          </button>
        ))}
      </div>

      {/* Next button — below the keypad, matching the mockup */}
      <div className="px-6 pt-2 pb-app shrink-0">
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
      </motion.div>

      {onChangeMint && (
        <MintSelectBottomSheet
          isOpen={mintSheetOpen}
          onClose={() => setMintSheetOpen(false)}
          onSelect={(url) => {
            onChangeMint(url)
            setMintSheetOpen(false)
          }}
          selectedMintUrl={mintUrl}
          filterFn={(m) => (m.balance ?? 0) > 0}
        />
      )}
    </div>
  )
}
