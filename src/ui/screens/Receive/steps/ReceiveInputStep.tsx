/**
 * ReceiveInputStep — Request creation for receive flow
 * Creates both Lightning invoice data and eCash payment request simultaneously
 * for unified BIP-321 QR code generation
 */

import { useState, useCallback, useMemo } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { hapticTap, hapticError } from '@/utils/haptic'
import { MintCardSelector } from '@/ui/components/wallet'
import { Button } from '@/ui/components/common/Button'
import { AmountInput } from '@/ui/components/common/AmountInput'
import { createNostrPaymentRequest, createDualTransportPaymentRequest } from '@/services/cashu/nut18'
import { encodeNprofile } from '@/services/crypto'
import { useMintNut18Support } from '@/hooks/use-mint-nut18-support'

interface ReceiveInputStepProps {
  onBack: () => void
  onNext: (data: {
    amount: number
    mintUrl: string
    ecashRequest?: string
    ecashRequestId?: string
    httpEndpoint?: string
  }) => void
  onActivateListening?: () => void
  initialAmount?: number
  initialMintUrl?: string | null
  isLoading?: boolean
}

export function ReceiveInputStep({
  onBack,
  onNext,
  onActivateListening,
  initialAmount = 0,
  initialMintUrl,
  isLoading = false,
}: ReceiveInputStepProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const addToast = useAppStore((s) => s.addToast)

  // State
  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(
    initialMintUrl || settings.mints[0] || null
  )
  const [memo, setMemo] = useState('')

  // Check if selected mint supports NUT-18 HTTP transport
  const { supportsHttp } = useMintNut18Support(selectedMintUrl)

  // User's nprofile for ecash Nostr transport
  const userNprofile = useMemo(() => {
    if (!nostrPubkey || !settings.relays?.length) return null
    try {
      return encodeNprofile(nostrPubkey, settings.relays)
    } catch {
      return null
    }
  }, [nostrPubkey, settings.relays])

  // Handle next — always create ecash request alongside Lightning
  const handleNext = useCallback(() => {
    const numericAmount = parseInt(amount, 10)
    if (!numericAmount || numericAmount <= 0) {
      addToast({ type: 'error', message: t('receive.amountRequired'), duration: 3000 })
      return
    }
    if (!selectedMintUrl) {
      addToast({ type: 'error', message: t('payment.selectMint'), duration: 3000 })
      return
    }

    hapticTap()

    // Always create ecash payment request for unified QR
    let ecashRequest: string | undefined
    let ecashRequestId: string | undefined
    let httpEndpoint: string | undefined

    // NUT-18 요청 생성 → Active 모드로 전환 (5초 간격 health check)
    onActivateListening?.()

    if (userNprofile) {
      if (supportsHttp) {
        // Dual transport: Nostr (primary) + HTTP POST (fallback)
        const result = createDualTransportPaymentRequest({
          amount: numericAmount,
          mints: [selectedMintUrl],
          nostrTarget: userNprofile,
          mintUrl: selectedMintUrl,
          description: memo.trim() || undefined,
          singleUse: true,
          idPrefix: 'wallet',
        })
        ecashRequest = result.request
        ecashRequestId = result.id
        httpEndpoint = result.httpEndpoint
      } else {
        // Nostr-only transport
        const result = createNostrPaymentRequest({
          amount: numericAmount,
          mints: [selectedMintUrl],
          nostrTarget: userNprofile,
          description: memo.trim() || undefined,
          singleUse: true,
          idPrefix: 'wallet',
        })
        ecashRequest = result.request
        ecashRequestId = result.id
      }
    } else {
      // No Nostr profile — Lightning-only fallback (shouldn't happen in zappi-wallet)
      hapticError()
      console.warn('[ReceiveInputStep] No Nostr profile available, Lightning-only mode')
    }

    onNext({
      amount: numericAmount,
      mintUrl: selectedMintUrl,
      ecashRequest,
      ecashRequestId,
      httpEndpoint,
    })
  }, [amount, memo, selectedMintUrl, userNprofile, supportsHttp, onNext, onActivateListening, addToast, t])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="relative flex items-center px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-background-hover transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center z-10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle pointer-events-none">
          {t('receive.createRequest')}
        </h1>
      </header>

      {/* Mint Card Selector */}
      <div className="shrink-0 pt-6 pb-8">
        <MintCardSelector
          selectedMintUrl={selectedMintUrl}
          onSelect={setSelectedMintUrl}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 space-y-6">
        {/* Amount */}
        <AmountInput
          amount={amount}
          onAmountChange={setAmount}
          label={t('receive.howMuch')}
        />

        {/* Memo — optional, used as ecash request description */}
        <div>
          <p className="text-label text-foreground-muted leading-snug">{t('receive.memoPlaceholder')}</p>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={100}
            className="w-full bg-transparent border-0 border-b border-b-border rounded-none py-2 text-body font-medium text-foreground focus:outline-none focus:border-b-foreground transition-colors"
          />
        </div>
      </div>

      {/* Bottom Action */}
      <div className="p-4 pb-safe">
        <Button
          variant="brand"
          size="xl"
          onClick={handleNext}
          loading={isLoading}
          className="w-full"
        >
          {t('receive.next')}
        </Button>
      </div>
    </div>
  )
}
