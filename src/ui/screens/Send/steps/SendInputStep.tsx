/**
 * SendInputStep — Destination-only step (rewritten)
 * Conversational "누구에게 보낼까요?" with single destination input.
 * Auto-advance when bolt11 with amount is scanned/pasted.
 * Supports @wallet detection for internal mint transfers.
 * Next button stays disabled until the destination is validated —
 * token creation lives in the Token tab (not this flow).
 *
 * 검증 로직(디바운스 판정·processExternalInput·handleNext·§8.5 계약)은
 * use-send-input-validation 훅 소유 — 이 컴포넌트는 표현만 담당한다 (R2-C).
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

  // 검증 상태/로직 — 훅 소유 (§8.5: 타이핑-중 네트워크 0, 제출 시 검증)
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

  // Derive showMyWallets from destination + validatedData
  const showMyWallets = useMemo(() => {
    const trimmed = destination.trim()
    if (!trimmed || !trimmed.startsWith('@')) return false
    if (validatedData?.type === 'my-wallet' && destination === `@${validatedData.targetMintName}`) return false
    return true
  }, [destination, validatedData])

  // My wallets list (exclude currently selected source mint)
  const myWallets = useMemo(() => {
    return settings.mints
      .filter((url) => url !== mintUrl)
      .map((url) => ({
        url,
        name: getDisplayName(url),
        iconUrl: getIconUrl(url),
      }))
  }, [settings.mints, mintUrl, getDisplayName, getIconUrl])

  // Segment: contacts vs wallets — 기본 탭은 파생값(연락처 있으면 contacts,
  // 없고 내 지갑 있으면 wallets), 사용자가 고르면 그 선택이 우선.
  // 구현 주: 원본은 setState-in-effect 패턴이었다 — 추출로 컴파일러 bail-out이
  // 풀리며 react-hooks/set-state-in-effect가 가시화되어 파생 상태로 재구성
  // (React 권장). 유일한 시맨틱 델타: 무선택 상태에서 wallets 표시 중 두 목록이
  // 모두 비면 구현전은 'wallets' 잔존, 현재는 'contacts' 폴백 — 둘 다 빈 상태 UI.
  const [userListTab, setUserListTab] = useState<'wallets' | 'contacts' | null>(null)
  const listTab = userListTab
    ?? (contacts.length > 0 ? 'contacts' : myWallets.length > 0 ? 'wallets' : 'contacts')
  const setListTab = useCallback((tab: 'wallets' | 'contacts') => {
    setUserListTab(tab)
  }, [])

  // Filter my wallets by @ search query
  const filteredWallets = useMemo(() => {
    if (!destination.startsWith('@')) return myWallets
    const query = destination.slice(1).toLowerCase()
    if (!query) return myWallets
    return myWallets.filter((w) => w.name.toLowerCase().includes(query))
  }, [myWallets, destination])

  // Handle my wallet selection
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

  // Handle QR scan
  const handleScan = useCallback((result: string) => {
    setShowScanner(false)
    processExternalInput(result)
  }, [processExternalInput])

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('send.title')} onBack={onBack} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-6">
        {/* Question */}
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
              // 제출 검증 중 입력 잠금 (7단계 리뷰 #7): §8.5로 매 제출이 원격
              // 왕복을 수반하게 되어, 검증 중 타이핑이 완료 시점의
              // applyDestinationState에 덮여 이전 주소로 진행되는 창이 넓어졌다
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

        {/* Segment: Contacts / My Wallets */}
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

      {/* Bottom — button */}
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
