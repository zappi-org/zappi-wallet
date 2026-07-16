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
import { Zap, Hash, Link } from 'lucide-react'
import { CameraFilled } from '@/ui/components/icons/CameraFilled'
import cardLogo from '@/assets/card-logo.svg'
import { getInputTypeLabel } from '@/ui/utils/inputTypeLabel'
import { useTranslation } from 'react-i18next'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { hapticTap } from '@/ui/utils/haptic'
import { Button } from '@/ui/components/common/Button'
import { Spinner } from '@/ui/components/common/Spinner'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { SegmentControl } from '@/ui/components/common/SegmentControl'
import type { ValidatedData } from '@/core/domain/input-types'
import type { ContactAddressType } from '@/core/types'
import type { SendableValidatedData } from '../SendFlow'
import { useSendInputValidation } from './use-send-input-validation'

interface SendDestinationStepProps {
  onBack: () => void
  onNext: (data: {
    destination: string
    validatedData?: SendableValidatedData
    amountFromInvoice?: number
    mintUrl?: string
  }) => void
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
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)

  // Validation state/logic — owned by the hook (no network while typing, validate on submit)
  const {
    destination,
    updateDestination,
    detectedTypes,
    validatedData,
    isPreValidating,
    preValidationError,
    isValidating,
    contacts,
    applyDestinationState,
    processExternalInput,
    handleNext,
  } = useSendInputValidation({
    onNext,
    onRedirect,
    initialDestination,
    initialAddress,
    initialValidatedData,
    mintUrl,
    onRouteValidated,
    onRequestMintSelection,
    getDisplayName,
  })

  const [showScanner, setShowScanner] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

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
  const listTab = userListTab
    ?? (contacts.length > 0 ? 'contacts' : myWallets.length > 0 ? 'wallets' : 'contacts')
  const setListTab = useCallback((tab: 'wallets' | 'contacts') => {
    setUserListTab(tab)
  }, [])

  const filteredWallets = useMemo(() => {
    if (!destination.startsWith('@')) return myWallets
    const query = destination.slice(1).toLowerCase()
    if (!query) return myWallets
    return myWallets.filter((w) => w.name.toLowerCase().includes(query))
  }, [myWallets, destination])

  const handleSelectMyWallet = useCallback((walletUrl: string, walletName: string) => {
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
  }, [applyDestinationState])

  const handleScan = useCallback((result: string) => {
    setShowScanner(false)
    processExternalInput(result)
  }, [processExternalInput])

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('send.title')} onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-6 pt-6">
        <h2 className="text-heading font-semibold text-foreground break-keep">
          {t('send.destination.whoToSend')}
        </h2>
        {/* Destination input — placeholder smaller than title */}
        <div className="mt-6">
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              ref={inputRef}
              type="text"
              value={destination}
              onChange={(e) => updateDestination(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleNext() } }}
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
              className="flex-1 min-w-0 bg-transparent py-1.5 text-title font-medium text-foreground placeholder:text-foreground-muted placeholder:font-medium focus:outline-none"
            />
            <button
              onClick={() => setShowScanner(true)}
              aria-label={t('scanner.title')}
              className="w-10 h-10 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors shrink-0"
            >
              <CameraFilled className="text-foreground-muted" />
            </button>
          </div>

          {/* Detected type badge — fixed space below underline */}
          <div className="h-7 flex items-center mt-1">
            {isPreValidating ? (
              <Spinner size="sm" color="muted" />
            ) : (
              detectedTypes.length > 0 && !detectedTypes.includes('my-wallet') && (
                <div className="flex gap-1.5">
                  {detectedTypes.map((badge) => (
                    <span key={badge} className="inline-block text-label font-medium px-2.5 py-0.5 rounded-full bg-brand/10 text-brand">
                      {getInputTypeLabel(badge)}
                    </span>
                  ))}
                </div>
              )
            )}
          </div>
          <div className="h-5 flex items-center" data-testid="pre-validation-error-area">
            {preValidationError && (
              <p className="text-xs text-destructive">{preValidationError}</p>
            )}
          </div>

        </div>

        {/* My wallets dropdown — @ search mode */}
        {showMyWallets && (
          <div className="mt-4">
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
              <p className="text-caption text-foreground-muted py-3">
                {t('send.noOtherWallets')}
              </p>
            )}
          </div>
        )}

        {!showMyWallets && (
          <div className="mt-4">
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
                        onError={(e) => { (e.target as HTMLImageElement).src = cardLogo }}
                      />
                      <div className="flex-1 min-w-0 text-left">
                        <p className="text-subtitle font-medium text-foreground truncate">{wallet.name}</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <p className="text-caption text-foreground-muted py-6 text-center">{t('send.noOtherWallets')}</p>
                )
              ) : (
                contacts.length > 0 ? (
                  contacts.map((contact) => {
                    const iconMap: Record<ContactAddressType, typeof Zap> = { lightning: Zap, npub: Hash, custom: Link }
                    const Icon = iconMap[contact.addressType]
                    return (
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
                        <div className="w-9 h-9 rounded-full bg-brand/8 flex items-center justify-center shrink-0">
                          <Icon className="w-4 h-4 text-brand" />
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-subtitle font-medium text-foreground truncate">{contact.name}</p>
                          <p className="text-caption text-foreground-muted truncate">{contact.address}</p>
                        </div>
                      </button>
                    )
                  })
                ) : (
                  <p className="text-caption text-foreground-muted py-6 text-center">{t('contacts.emptyTitle')}</p>
                )
              )}
            </div>
          </div>
        )}
      </div>

      <div className="px-6 pb-app shrink-0">
        <Button
          variant="brand"
          size="xl"
          onClick={handleNext}
          loading={isLoading || isValidating || isPreValidating}
          disabled={!destination.trim() || !!preValidationError}
          className="w-full"
        >
          {t('send.next')}
        </Button>
      </div>

      <QrScannerModal isOpen={showScanner} onClose={() => setShowScanner(false)} onScan={handleScan} />
    </div>
  )
}
