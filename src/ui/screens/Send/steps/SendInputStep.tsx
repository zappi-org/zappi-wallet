/**
 * SendInputStep — Destination-only step (rewritten)
 * Conversational "who to send to?" with a single destination input.
 * Auto-advance when bolt11 with amount is scanned/pasted.
 * Supports @wallet detection for internal mint transfers.
 * Next button stays disabled until the destination is validated —
 * token creation lives in the Token tab (not this flow).
 *
 * Validation logic (debounce decisions, processExternalInput, handleNext, the
 * validation contract) is owned by the use-send-input-validation hook — this
 * component only renders.
 */

import { useState, useCallback, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion, useIsPresent } from 'motion/react'
import { useKeyboardInset } from '@/ui/hooks/use-keyboard-inset'
import { CameraFilled } from '@/ui/components/icons/CameraFilled'
import cardLogo from '@/assets/card-logo.svg'
import { useTranslation } from 'react-i18next'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { hapticTap } from '@/ui/utils/haptic'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { SegmentControl } from '@/ui/components/common/SegmentControl'
import type { ValidatedData } from '@/core/domain/input-types'
import type { SendableValidatedData } from '../SendFlow'
import { ContactAddressIcon } from '@/ui/components/payment/RecipientEndpointIcon'
import { SEND_RECIPIENT_LAYOUT_ID, recipientMorphTransition } from '../sendMorph'
import { fadeTransition } from '@/ui/utils/motion'
import { useSendInputValidation } from './use-send-input-validation'

interface SendDestinationStepProps {
  onBack: () => void
  onNext: (data: {
    destination: string
    validatedData?: SendableValidatedData
    amountFromInvoice?: number
    mintUrl?: string
  }) => void
  /** Fired when the input is empty and the user chooses to create a bearer token instead. */
  onDirectTransfer: () => void
  onRedirect?: (validatedData: ValidatedData) => void
  initialDestination?: string
  initialAddress?: string
  initialValidatedData?: SendableValidatedData | null
  mintUrl: string
  isLoading?: boolean
  /** Delegate non-sendable input (cashu-token, amount-only) to universal router. */
  onRouteValidated?: (data: ValidatedData) => void
  /** Open the lifted MintSelectBottomSheet (owned by SendFlow). */
  onRequestMintSelection?: (req: {
    destination: string
    validatedData: SendableValidatedData
    commonMintUrls: string[]
    infoText?: string
  }) => void
}

export function SendInputStep({
  onBack,
  onNext,
  onDirectTransfer,
  onRedirect,
  initialDestination = '',
  initialAddress,
  initialValidatedData,
  mintUrl,
  isLoading = false,
  onRouteValidated,
  onRequestMintSelection,
}: SendDestinationStepProps) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)

  // Text-morph handoff: on advance, swap the input for a static text stand-in
  // committed in the same frame (flushSync) so only the TEXT — not the pill —
  // pairs with the amount scene's recipient via layoutId
  const [leaving, setLeaving] = useState(false)
  const advanceWithTextMorph = useCallback(
    (data: {
      destination: string
      validatedData?: SendableValidatedData
      amountFromInvoice?: number
      mintUrl?: string
    }) => {
      flushSync(() => setLeaving(true))
      onNext(data)
    },
    [onNext],
  )

  // Validation state/logic — owned by the hook (no network while typing, validate on submit)
  const {
    destination,
    updateDestination,
    validatedData,
    isPreValidating,
    preValidationError,
    isValidating,
    contacts,
    contactsReady,
    applyDestinationState,
    processExternalInput,
    handleNext,
  } = useSendInputValidation({
    onNext: advanceWithTextMorph,
    onRedirect,
    initialDestination,
    initialAddress,
    initialValidatedData,
    mintUrl,
    onRouteValidated,
    onRequestMintSelection,
    getDisplayName,
  })

  // If the advance is rejected upstream (offline/route/validation toast) while
  // this scene is still active, bring the input back. Render-phase adjustment
  // (react.dev: "adjusting state when a prop changes") — an effect here would
  // cascade renders. isPresent blocks the reset while the scene exits after a
  // SUCCESSFUL advance; resetting there would yank the morph source mid-flight.
  const isPresent = useIsPresent()
  const busy = isLoading || isValidating
  const [prevBusy, setPrevBusy] = useState(busy)
  if (prevBusy !== busy) {
    setPrevBusy(busy)
    if (!busy && leaving && isPresent) setLeaving(false)
  }

  const [showScanner, setShowScanner] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Empty input → offer bearer-token creation instead of Next (direct-transfer branch)
  const hasDestination = destination.trim().length > 0
  // Lift the primary action above the soft keyboard as it opens
  const kbInset = useKeyboardInset()

  // Blur BEFORE advancing so keyboard retraction gets a head start on the
  // scene morph instead of running on top of it (PWA: viewport-only resize)
  const submitDestination = useCallback(() => {
    inputRef.current?.blur()
    handleNext()
  }, [handleNext])
  const startDirectTransfer = useCallback(() => {
    inputRef.current?.blur()
    onDirectTransfer()
  }, [onDirectTransfer])

  const showMyWallets = useMemo(() => {
    const trimmed = destination.trim()
    if (!trimmed || !trimmed.startsWith('@')) return false
    if (validatedData?.type === 'my-wallet' && destination === `@${validatedData.targetMintName}`) return false
    return true
  }, [destination, validatedData])

  const myWallets = useMemo(() => {
    return settings.mints
      .filter((url) => url !== mintUrl)
      .map((url) => ({
        url,
        name: getDisplayName(url),
        iconUrl: getIconUrl(url),
      }))
  }, [settings.mints, mintUrl, getDisplayName, getIconUrl])

  // Segment: contacts vs wallets — default tab is derived (contacts if any exist,
  // else wallets if you have other wallets); an explicit user choice takes priority.
  const [userListTab, setUserListTab] = useState<'wallets' | 'contacts' | null>(null)
  const listTab = userListTab ?? (contacts.length > 0 ? 'contacts' : myWallets.length > 0 ? 'wallets' : 'contacts')
  const setListTab = useCallback((tab: 'wallets' | 'contacts') => {
    setUserListTab(tab)
  }, [])

  const filteredWallets = useMemo(() => {
    if (!destination.startsWith('@')) return myWallets
    const query = destination.slice(1).toLowerCase()
    if (!query) return myWallets
    return myWallets.filter((w) => w.name.toLowerCase().includes(query))
  }, [myWallets, destination])

  const handleSelectMyWallet = useCallback(
    (walletUrl: string, walletName: string) => {
      hapticTap()
      applyDestinationState({
        destination: `@${walletName}`,
        rawAddress: null,
        validatedData: {
          type: 'my-wallet',
          targetMintUrl: walletUrl,
          targetMintName: walletName,
        },
        detectedTypes: ['my-wallet'],
      })
    },
    [applyDestinationState],
  )

  const handleScan = useCallback(
    (result: string) => {
      setShowScanner(false)
      processExternalInput(result)
    },
    [processExternalInput],
  )

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title={t('send.title')} onBack={onBack} />

      {/* Scene content fades here (not on the SendFlow scene wrapper) so the
          layoutId morph text is never dimmed by an animating ancestor */}
      <motion.div
        layoutScroll
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, pointerEvents: 'none' }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="flex-1 overflow-y-auto px-6 pt-20"
      >
        <h2 className="text-[26px] font-bold text-foreground break-keep text-center leading-snug">
          {t('send.destination.whoToSend')}
        </h2>
        {/* Destination input — pill style. The pill itself stays put and fades
            with the scene; on advance the input is swapped for a text stand-in
            (layoutId) so only the TEXT morphs to the amount scene's recipient. */}
        <div className="relative flex items-center gap-1 rounded-2xl bg-background-card px-4 focus-within:ring-1 focus-within:ring-foreground/15 transition-shadow mt-7">
          <div className="flex-1 min-w-0 flex flex-col">
            {/* The stand-in unmounts the moment the scene starts exiting
                (!isPresent) — motion then snapshots it and the amount-scene
                text flies SOLO from that box. Keeping it mounted would pair
                the two into motion's auto-crossfade, which dims the flight. */}
            {leaving && !isPresent ? (
              <span aria-hidden className="block py-3.5 text-body font-medium text-transparent select-none">
                {destination || ' '}
              </span>
            ) : leaving ? (
              <motion.span
                layoutId={SEND_RECIPIENT_LAYOUT_ID}
                transition={recipientMorphTransition(reduceMotion)}
                className="self-start max-w-full truncate py-3.5 text-body font-medium text-foreground"
              >
                {destination}
              </motion.span>
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={destination}
                onChange={(e) => updateDestination(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitDestination()
                  }
                }}
                onPaste={(e) => {
                  e.preventDefault()
                  const text = e.clipboardData.getData('text')
                  if (text) processExternalInput(text)
                }}
                placeholder={t('send.destination.placeholder')}
                // Lock input during submit validation: since every submit now makes a
                // remote round-trip, typing mid-validation could be overwritten by the
                // applyDestinationState on completion, widening the window to proceed with a stale address
                readOnly={isValidating}
                className="w-full min-w-0 bg-transparent text-body font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none truncate py-3.5"
              />
            )}
          </div>
          <button
            onClick={() => setShowScanner(true)}
            aria-label={t('scanner.title')}
            className="relative w-9 h-9 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors shrink-0"
          >
            <CameraFilled className="text-foreground-muted" />
          </button>
        </div>

        {/* Reserved space so the error message pops in without shifting the tabs */}
        <div className="h-5 flex items-center mt-1.5" data-testid="pre-validation-error-area">
          {preValidationError && <p className="text-xs text-destructive">{preValidationError}</p>}
        </div>

        {/* My wallets dropdown — @ search mode */}
        <AnimatePresence initial={false} mode="sync">
          {showMyWallets && (
            <motion.div
              key="wallet-search-results"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fadeTransition(reduceMotion, 0.16)}
            className="mt-4"
          >
            <p className="text-body font-semibold text-foreground mb-3">{t('send.myWalletList')}</p>
            {filteredWallets.length > 0 ? (
              filteredWallets.map((wallet) => (
                <button
                  key={wallet.url}
                  onClick={() => handleSelectMyWallet(wallet.url, wallet.name)}
                  className="w-full flex items-center gap-3 py-3 border-b border-border/40 active:bg-foreground/[0.03] transition-colors"
                >
                  <img
                    src={wallet.iconUrl || cardLogo}
                    alt=""
                    className="w-9 h-9 rounded-full object-contain shrink-0 bg-foreground/[0.04]"
                  />
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-subtitle font-medium text-foreground truncate">{wallet.name}</p>
                  </div>
                </button>
              ))
            ) : (
              <p className="text-caption text-foreground-muted py-3">{t('send.noOtherWallets')}</p>
            )}
            </motion.div>
          )}

          {!showMyWallets && contactsReady && (
            <motion.div
              key="destination-lists"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fadeTransition(reduceMotion, 0.16)}
            className="mt-4"
          >
            <SegmentControl
              value={listTab}
              onChange={setListTab}
              options={[
                { value: 'contacts' as const, label: t('contacts.title') },
                { value: 'wallets' as const, label: t('send.myWalletList') },
              ]}
            />

            <div className="mt-3 max-h-[240px] overflow-y-auto">
              {listTab === 'wallets' ? (
                myWallets.length > 0 ? (
                  myWallets.map((wallet) => (
                    <button
                      key={wallet.url}
                      onClick={() => handleSelectMyWallet(wallet.url, wallet.name)}
                      className="w-full flex items-center gap-3 py-3 border-b border-border/40 active:bg-foreground/[0.03] transition-colors"
                    >
                      <img
                        src={wallet.iconUrl || cardLogo}
                        alt=""
                        className="w-9 h-9 rounded-full object-contain shrink-0 bg-foreground/[0.04]"
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).src = cardLogo
                        }}
                      />
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-subtitle font-medium text-foreground truncate">{wallet.name}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="text-caption text-foreground-muted py-6 text-center">{t('send.noOtherWallets')}</p>
                )
              ) : contacts.length > 0 ? (
                contacts.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => {
                      hapticTap()
                      applyDestinationState({
                        destination: contact.name,
                        rawAddress: contact.address,
                        validatedData: null,
                        detectedTypes: [],
                      })
                    }}
                    className="w-full flex items-center gap-3 py-3 border-b border-border/40 transition-colors active:bg-foreground/[0.03]"
                  >
                    {/* Same glyphs as the 주소록 tab — one identity per contact everywhere. */}
                    <div className="w-9 h-9 flex items-center justify-center shrink-0">
                      <ContactAddressIcon type={contact.addressType} />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-subtitle font-medium text-foreground truncate">{contact.name}</p>
                      <p className="text-caption text-foreground-muted truncate">{contact.address}</p>
                    </div>
                  </button>
                ))
              ) : (
                <p className="text-caption text-foreground-muted py-6 text-center">{t('contacts.emptyTitle')}</p>
              )}
            </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, pointerEvents: 'none' }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="shrink-0"
      >
        <div className="px-6 pb-app" style={{ transform: `translate3d(0, ${-kbInset}px, 0)` }}>
          <Button
            variant="brand"
            size="xl"
            onClick={hasDestination ? submitDestination : startDirectTransfer}
            loading={hasDestination && (isLoading || isValidating || isPreValidating)}
            disabled={hasDestination && !!preValidationError}
            className="w-full"
          >
            {hasDestination ? t('send.next') : t('send.direct.cta')}
          </Button>
        </div>
      </motion.div>

      <QrScannerModal isOpen={showScanner} onClose={() => setShowScanner(false)} onScan={handleScan} />
    </div>
  )
}
