/**
 * SendAmountStep — Amount entry with a numeric keypad.
 * The recipient picked on the previous step rides up here as a collapsed
 * "TO name" header (or "직접 전달" for the bearer-token branch); the amount
 * hero + keypad take the stage. Tapping the header returns to edit.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { motion, AnimatePresence, useReducedMotion } from 'motion/react'
import { ChevronDown, ChevronRight, Lock } from 'lucide-react'
import { useWallet } from '@/ui/hooks/use-wallet'
import { useAppStore } from '@/store'
import { hapticTap, hapticSuccess } from '@/ui/utils/haptic'
import { formatFiatInputForDisplay, useFormatFiat, useFormatSats } from '@/utils/format'
import { useFiatToggle } from '@/ui/hooks/use-fiat-toggle'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { AmountEntry, type AmountEntryFiatState } from '@/ui/components/payment/AmountEntry'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { PaymentReceipt, type PaymentReceiptRow } from '@/ui/components/payment/PaymentReceipt'
import sendSuccessImg from '@/assets/send-success.png'
import { MemoSheet } from '../MemoSheet'
import { getMintBalance } from '@/utils/url'
import {
  confirmAmountSizeClass,
  findContactName,
  formatLightningAddress,
  formatNpubShort,
  formatRecipientDisplayText,
  getConfirmDisplayInfo,
  isDirectCashuRecipient,
  middleEllipsis,
  shouldShowRecipientInMainMessage,
} from '../sendDisplayHelpers'
import { useContacts } from '@/ui/hooks/use-contacts'
import type { SendableValidatedData } from '../SendFlow'
import type { PaymentRoute } from '@/core/ports/driving/routing.usecase'
import { SEND_RECIPIENT_LAYOUT_ID, recipientMorphTransition } from '../sendMorph'
import { fadeTransition } from '@/ui/utils/motion'

export interface SendAmountDraft {
  amount: number
  memo: string
  isFiatMode: boolean
  fiatAmount: string
}

interface SendAmountStepProps {
  onBack: (draft: SendAmountDraft) => void
  onNext: (data: SendAmountDraft) => void
  mintUrl: string
  destination?: string
  validatedData?: SendableValidatedData
  /** Selected payment route — refines the confirm identity line for unified QR data. */
  route?: PaymentRoute
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
  /** Swaps the keypad for the in-place confirm controls (fee/memo rows + Cancel/Send). */
  confirming?: boolean
  /** Route execution is in flight — same confirm scene, controls swap for a status row. */
  sending?: boolean
  /** Sending has run long (watchdog) — the status row offers an exit. */
  sendingSlow?: boolean
  /** Result landed — feed the receipt out, tear it, stamp it. */
  sendingFinishing?: boolean
  /** Leave the flow while the transfer keeps settling in the background. */
  onExitSending?: () => void
  feeQuote?: number | 'pending' | 'unavailable'
  /** Balance captured after the temporary fee-estimation lock was released. */
  quotedBalance?: number | null
  onRetryFee?: () => void
  confirmError?: string | null
  confirmMemo?: string
  onEditMemo?: (memo: string) => void
  onCancelConfirm?: () => void
  onConfirmSend?: () => void | Promise<void>
}

export function SendAmountStep({
  onBack,
  onNext,
  mintUrl,
  destination,
  validatedData,
  route,
  initialAmount = 0,
  initialMemo = '',
  initialFiatMode = false,
  initialFiatAmount = '',
  isLoading = false,
  displayName,
  directTransfer = false,
  onChangeMint,
  confirming = false,
  sending = false,
  sendingSlow = false,
  sendingFinishing = false,
  onExitSending,
  feeQuote,
  quotedBalance,
  onRetryFee,
  confirmError,
  confirmMemo = '',
  onEditMemo,
  onCancelConfirm,
  onConfirmSend,
}: SendAmountStepProps) {
  const { t } = useTranslation()
  const { balance } = useWallet()
  const addToast = useAppStore((s) => s.addToast)
  const formatSats = useFormatSats()
  const toFiat = useFormatFiat()
  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)
  const reduceMotion = useReducedMotion()

  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [mintSheetOpen, setMintSheetOpen] = useState(false)
  const [memoSheetOpen, setMemoSheetOpen] = useState(false)
  const [sendBusy, setSendBusy] = useState(false)
  const memo = initialMemo

  // AmountEntry owns the interactive fiat toggle; SendAmountStep keeps only the
  // store-derived outputs (currencySymbol/showFiat) for the confirm scene and
  // lifts the editing mode/draft up via onFiatStateChange.
  const { currencySymbol, showFiat } =
    useFiatToggle(amount, setAmount, { initialFiatMode, initialFiatAmount })

  const [heroFiat, setHeroFiat] = useState<AmountEntryFiatState>({
    isFiatMode: initialFiatMode,
    fiatAmount: initialFiatAmount,
  })
  const isFiatMode = heroFiat.isFiatMode
  const fiatInput = heroFiat.fiatAmount

  const mintBalance = getMintBalance(mintUrl, balance.byMint)
  const mintName = getDisplayName(mintUrl)
  const mintIconUrl = getIconUrl(mintUrl)
  const numericAmount = parseInt(amount, 10) || 0
  const isOverBalance = numericAmount > mintBalance

  // Confirm-variant gates: Send needs a numeric fee quote and amount+fee within balance.
  const feeReady = typeof feeQuote === 'number'
  const totalNeeded = feeReady ? numericAmount + feeQuote : null
  const validationBalance = feeReady && quotedBalance != null ? quotedBalance : mintBalance
  const insufficientForFee = totalNeeded !== null && totalNeeded > validationBalance
  const canSend = confirming && feeReady && numericAmount > 0 && !insufficientForFee && !sendBusy

  // The seal lands during the finishing choreography — buzz exactly once.
  const stampedRef = useRef(false)
  const handleStampComplete = () => {
    if (stampedRef.current) return
    stampedRef.current = true
    hapticSuccess()
  }

  const handleConfirmSend = async () => {
    if (!canSend || !onConfirmSend) return
    setSendBusy(true)
    try {
      await onConfirmSend()
    } finally {
      setSendBusy(false)
    }
  }

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
    if (validatedData?.type === 'bolt11') return t('send.confirm.paymentRequest')
    if (validatedData?.type === 'cashu-request' && !isDirectCashuRecipient(validatedData)) {
      return t('send.confirm.paymentRequest')
    }
    if (displayName) return formatRecipientDisplayText(displayName)
    if (contactName) return formatRecipientDisplayText(contactName)
    if (validatedData?.type === 'my-wallet') return formatRecipientDisplayText(validatedData.targetMintName)
    if (validatedData?.type === 'lightning-address') return validatedData.address
    if (validatedData?.type === 'lnurl-pay') return validatedData.params?.domain || 'LNURL'
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
      return middleEllipsis(validatedData.invoice, 8, 4)
    }
    return null
  }, [validatedData, contactName])

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
  const amountSizeClass = confirmAmountSizeClass(displayAmount)

  const handleBack = useCallback(() => {
    onBack({ amount: numericAmount, memo, isFiatMode, fiatAmount: fiatInput })
  }, [onBack, numericAmount, memo, isFiatMode, fiatInput])

  // Recipient content shared by both the editing header and the confirm
  // ticket's TO node — only the wrapping element differs (button vs div).
  const recipientContent = directTransfer ? (
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
  )
  const hasRecipient = directTransfer || recipientLabel
  // Both endpoints share layoutId + transition so the snapshot glide reads as
  // one flight; explicit opacity overrides motion's auto-crossfade, which
  // freezes the incoming element semi-transparent for the whole flight —
  // the text must stay solid while it glides. Exactly one of the two mounts
  // per commit (editing OR confirm), so this is a single-instance handoff,
  // never a live crossfade pair.
  const recipientMotionProps = {
    layoutId: SEND_RECIPIENT_LAYOUT_ID,
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { ...recipientMorphTransition(reduceMotion), opacity: { duration: 0.15, ease: 'easeOut' as const } },
  }

  // Editing header — tap to re-edit. Plain text per mockup; pinned at the
  // top while editing. Its layoutId is the LANDING point of the flow's one
  // flight (destination → amount); confirm has no second flight.
  const recipientBlock = hasRecipient && (
    <motion.button
      type="button"
      {...recipientMotionProps}
      whileTap={{ scale: 0.96 }}
      onClick={handleBack}
      className="shrink-0 mt-3 mx-auto px-4 py-2 flex flex-col items-center gap-0.5 max-w-[calc(100%-3rem)]"
    >
      {recipientContent}
    </motion.button>
  )

  // Confirm question — Toss voice: one i18n sentence per case, so every locale
  // orders recipient/amount/verb naturally. <b> carries the FULL identity
  // (a contact's name wins; the detail line then holds the raw identifier),
  // <amt> carries the amount at display size.
  const effectiveName = displayName || contactName || undefined
  const question = useMemo(() => {
    if (!confirming) return null
    if (directTransfer) {
      return { key: 'send.confirm.createQuestion' as const, values: { amount: displayAmount }, detail: null }
    }
    if (!validatedData) {
      return destination
        ? {
            key: 'send.confirm.question' as const,
            values: { recipient: formatRecipientDisplayText(destination, 20), amount: displayAmount },
            detail: null,
          }
        : { key: 'send.confirm.requestQuestion' as const, values: { amount: displayAmount }, detail: null }
    }
    if (validatedData.type === 'my-wallet') {
      return {
        key: 'send.confirm.transferQuestion' as const,
        values: { target: formatRecipientDisplayText(validatedData.targetMintName, 20), amount: displayAmount },
        detail: null,
      }
    }
    const info = getConfirmDisplayInfo(validatedData, route, t, effectiveName)
    const detailRaw = info.recipientDetail?.trim() ?? ''
    if (shouldShowRecipientInMainMessage(validatedData)) {
      let recipient: string
      if (effectiveName) recipient = formatRecipientDisplayText(effectiveName, 20)
      else if (validatedData.type === 'lightning-address') recipient = formatLightningAddress(validatedData.address, 34)
      else recipient = info.recipient
      return {
        key: 'send.confirm.question' as const,
        values: { recipient, amount: displayAmount },
        detail: detailRaw && detailRaw !== recipient ? detailRaw : null,
      }
    }
    // Anonymous payment request (bolt11 / lnurl / non-direct creq): no "to X" —
    // the identifier fingerprint below the question is the identity.
    return { key: 'send.confirm.requestQuestion' as const, values: { amount: displayAmount }, detail: detailRaw || null }
  }, [confirming, directTransfer, validatedData, destination, route, t, effectiveName, displayAmount])

  // Receipt content while the route executes — mirrors the question's
  // identity rules; the printing paper carries the who/cost story.
  const receiptRecipient = useMemo(() => {
    if (directTransfer) return t('send.direct.label')
    if (!question) return null
    if (question.key === 'send.confirm.question') return question.values.recipient
    if (question.key === 'send.confirm.transferQuestion') return question.values.target
    // Anonymous request: the fingerprint is the identity
    return question.detail
  }, [directTransfer, question, t])
  const receiptRows = useMemo<PaymentReceiptRow[]>(() => {
    const rows: PaymentReceiptRow[] = []
    if (receiptRecipient) rows.push({ label: t('send.receipt.recipient'), value: receiptRecipient })
    rows.push({ label: t('send.confirm.sourceMint'), value: mintName })
    if (feeReady) {
      rows.push({ label: t('send.confirm.estimatedFee'), value: formatSats(feeQuote) })
      rows.push({ label: t('send.confirm.total'), value: formatSats(totalNeeded ?? 0), strong: true })
    }
    if (confirmMemo) rows.push({ label: t('send.confirm.memo'), value: confirmMemo })
    return rows
  }, [receiptRecipient, mintName, feeReady, feeQuote, totalNeeded, confirmMemo, formatSats, t])

  return (
    <div className="flex flex-col h-full relative">
      {/* Confirm renames the screen to mark the stakes change; while the route
          executes the back arrow disappears instead of sitting dead. */}
      <ScreenHeader
        title={sending ? t('send.sending.title') : confirming ? t('send.confirm.title') : t('send.title')}
        onBack={sending || sendBusy ? undefined : handleBack}
      />

      {/* The pinned recipient pops out via its own presence (popLayout releases
          its space immediately so the confirm hero centers without a jump); it
          stays OUTSIDE any fading ancestor because it is the landing target of
          the flow's one remaining flight (destination → amount). */}
      <AnimatePresence mode="popLayout" initial={false}>
        {!confirming && recipientBlock}
      </AnimatePresence>

      {/* Mid region: editing hero ⟷ confirm hero swap as quiet fade-throughs.
          Restraint rule — one flight per flow (the destination text); the
          confirm step settles with a small slide+fade instead of flying. */}
      <AnimatePresence mode="popLayout">
        {confirming ? (
          <motion.div
            key="confirm-hero"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, pointerEvents: 'none' }}
            transition={fadeTransition(reduceMotion, 0.18)}
            className="flex-1 min-h-0 flex flex-col justify-center px-6"
          >
          {sending ? (
            /* Sending scene — the receipt IS the screen: the printed length is
               the progress cue, its rows are the reading material. */
            <div className="w-full">
              <PaymentReceipt
                status={sendingFinishing ? 'finishing' : 'printing'}
                title={t('send.receipt.title')}
                amount={displayAmount}
                fiat={showFiat || isFiatMode ? secondary : null}
                rows={receiptRows}
                statusLine={t('send.receipt.sending')}
                stampSrc={sendSuccessImg}
                onStampComplete={handleStampComplete}
              />
              {sendingSlow && onExitSending && (
                <div className="mt-5 flex flex-col items-center gap-1.5">
                  <span className="text-caption text-foreground-muted">{t('send.sending.networkDelay')}</span>
                  <button type="button" onClick={onExitSending} className="text-caption font-semibold text-brand">
                    {t('common.close')}
                  </button>
                </div>
              )}
            </div>
          ) : (
            question && (
              /* Toss-voice question: the sentence is the decision. */
              <div className="px-2 text-center">
                <p className="whitespace-pre-line text-[24px] font-semibold leading-snug text-foreground">
                  {/* Trans mis-infers a union i18nKey against its array overload;
                      the cast is safe — every member is a real locale key. */}
                  <Trans
                    i18nKey={question.key as 'send.confirm.question'}
                    values={question.values}
                    components={{
                      b: <span className="break-all text-brand" />,
                      amt: (
                        <span
                          className={`${amountSizeClass} font-bold tracking-tight ${
                            isOverBalance || insufficientForFee ? 'text-accent-danger' : ''
                          }`}
                        />
                      ),
                    }}
                  />
                </p>
                {question.detail && (
                  <p className="mt-3 break-all text-caption text-foreground-muted">{question.detail}</p>
                )}
                {(showFiat || isFiatMode) && (
                  <span className="mt-3 block text-body text-foreground-muted">{secondary}</span>
                )}
              </div>
            )
          )}
          </motion.div>
        ) : (
          <motion.div
            key="editing-hero"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={fadeTransition(reduceMotion, 0.15)}
            className="flex-1 min-h-0 flex flex-col"
          >
            <AmountEntry
              value={amount}
              onChange={setAmount}
              initialFiatMode={initialFiatMode}
              initialFiatAmount={initialFiatAmount}
              onFiatStateChange={setHeroFiat}
              insufficientBalance={isOverBalance}
              disabled={isAmountFixed}
              emptyPrompt={t('send.amount.prompt')}
              topSlot={
                <button
                  type="button"
                  onClick={onChangeMint ? () => setMintSheetOpen(true) : undefined}
                  disabled={!onChangeMint}
                  className="flex items-center justify-center gap-2 pt-2 mx-auto"
                >
                  <MintIcon iconUrl={mintIconUrl} imgSize="w-6 h-6" className="w-6 h-6" circle />
                  <span className="text-body font-medium text-foreground truncate max-w-[220px]">{mintName}</span>
                  {onChangeMint && <ChevronDown className="w-4 h-4 text-foreground-muted shrink-0" strokeWidth={2} />}
                </button>
              }
              bottomSlot={
                <>
                  {isAmountFixed && (
                    <div className="flex items-center justify-center gap-1 text-caption text-foreground-muted pb-1">
                      <Lock className="w-3 h-3" strokeWidth={2} />
                      {t('send.amount.fixedByInvoice')}
                    </div>
                  )}
                  {isOverBalance && (
                    <div className="text-center text-caption text-accent-danger pb-1">
                      {t('payment.insufficientBalance')} ({t('common.balance')} {formatSats(mintBalance)})
                    </div>
                  )}
                  <div className="px-6 pt-2 pb-app shrink-0">
                    <Button
                      variant="brand"
                      size="xl"
                      onClick={handleNext}
                      disabled={!numericAmount || numericAmount <= 0 || isOverBalance}
                      loading={isLoading}
                      className="w-full"
                    >
                      {t('common.confirm')}
                    </Button>
                  </div>
                </>
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom region: fee/memo + Cancel/Send (confirming) only — editing's
          keypad now lives inside AmountEntry, and sending keeps it empty.
          Lives outside the content-fade wrapper — popLayout pops the exiting
          child to position:absolute against the root, and a fade ancestor
          would dim the entering side (lessons #3). */}
      <AnimatePresence mode="popLayout" initial={false}>
        {confirming && !sending ? (
          <motion.div
            key="confirm-controls"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, pointerEvents: 'none' }}
            transition={fadeTransition(reduceMotion, 0.15)}
            className="shrink-0"
          >
            <div className="px-6">
              {/* Detail soft card — grouped rows above the error line and actions. */}
              <div className="rounded-2xl bg-background-card/70 px-4 py-1 mb-3">
                {/* Source mint moved here from the removed confirm diagram — the
                    only place left to switch the paying wallet mid-confirm. */}
                <button
                  type="button"
                  onClick={onChangeMint ? () => setMintSheetOpen(true) : undefined}
                  disabled={!onChangeMint || sendBusy}
                  className="w-full flex justify-between items-center gap-3 py-2.5 disabled:cursor-default"
                >
                  <span className="shrink-0 text-body text-foreground-muted">{t('send.confirm.sourceMint')}</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-body font-medium text-foreground">
                    <MintIcon iconUrl={mintIconUrl} imgSize="w-5 h-5" className="h-5 w-5 shrink-0" circle />
                    <span className="truncate">{mintName}</span>
                    {onChangeMint && (
                      <ChevronRight className="w-4 h-4 shrink-0 text-foreground-muted" strokeWidth={2} />
                    )}
                  </span>
                </button>
                <div className="flex justify-between items-center py-2.5">
                  <span className="text-body text-foreground-muted">{t('send.confirm.estimatedFee')}</span>
                  {feeReady ? (
                    <span className="text-body font-medium text-foreground">{formatSats(feeQuote)}</span>
                  ) : feeQuote === 'unavailable' ? (
                    <span className="text-body font-medium text-foreground-muted">
                      {t('send.confirm.feeUnavailableValue')}
                    </span>
                  ) : (
                    <span
                      role="status"
                      aria-label={t('send.confirm.feeChecking')}
                      className={`h-4 w-16 rounded-md bg-foreground-muted/15 ${reduceMotion ? '' : 'animate-pulse'}`}
                    />
                  )}
                </div>
                {/* Total = amount + fee. Hidden while the fee is unavailable —
                    the error line below already owns that state. */}
                {feeQuote !== 'unavailable' && (
                  <div className="flex justify-between items-center py-2.5">
                    <span className="text-body text-foreground-muted">{t('send.confirm.total')}</span>
                    {feeReady ? (
                      <span className="text-body font-semibold text-foreground">{formatSats(totalNeeded ?? 0)}</span>
                    ) : (
                      <span
                        className={`h-4 w-16 rounded-md bg-foreground-muted/15 ${reduceMotion ? '' : 'animate-pulse'}`}
                      />
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setMemoSheetOpen(true)}
                  disabled={sendBusy}
                  className="w-full flex justify-between items-center gap-3 py-2.5 disabled:cursor-default"
                >
                  <span className="shrink-0 text-body text-foreground-muted">{t('send.confirm.memo')}</span>
                  <span className="flex min-w-0 items-center text-body font-medium text-foreground">
                    <span className="truncate">{confirmMemo || t('send.memo.none')}</span>
                    <ChevronRight className="w-4 h-4 shrink-0 text-foreground-muted ml-1" strokeWidth={2} />
                  </span>
                </button>
              </div>
            </div>
            <div className="px-6 pb-1">
              {(confirmError || feeQuote === 'unavailable' || insufficientForFee) && (
                <div className="flex items-center justify-between gap-3 pb-2">
                  <p className="text-caption text-accent-danger">
                    {confirmError ??
                      (feeQuote === 'unavailable'
                        ? t('send.confirm.feeUnavailable')
                        : t('send.confirm.insufficientWithTotal', { total: formatSats(totalNeeded ?? 0) }))}
                  </p>
                  {feeQuote === 'unavailable' && onRetryFee && !sending && !confirmError && (
                    <button
                      type="button"
                      onClick={onRetryFee}
                      className="shrink-0 text-caption font-semibold text-brand"
                    >
                      {t('send.confirm.retryFee')}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-2.5 px-6 pt-2 pb-app">
              <Button variant="secondary" size="xl" onClick={onCancelConfirm} disabled={sendBusy} className="flex-1">
                {t('common.cancel')}
              </Button>
              <Button
                variant="brand"
                size="xl"
                onClick={handleConfirmSend}
                loading={sendBusy}
                disabled={!canSend}
                className="flex-[1.6]"
              >
                {t('send.confirm.send')}
              </Button>
            </div>
          </motion.div>
        ) : null}
        {/* Editing has no bottom region now — the keypad + Next live inside
            AmountEntry above, and the sending scene keeps the region empty. */}
      </AnimatePresence>

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

      <MemoSheet
        isOpen={memoSheetOpen}
        memo={confirmMemo}
        onSave={(m) => onEditMemo?.(m)}
        onClose={() => setMemoSheetOpen(false)}
      />
    </div>
  )
}
