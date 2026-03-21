/**
 * ReceiveInputStep — Request creation for receive flow
 * Method tab (Lightning/eCash), mint selection, amount input
 * Accessed via "요청 생성" from the main TokenReceiveStep
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
import type { ReceiveMethod } from '../ReceiveFlow'

interface ReceiveInputStepProps {
  onBack: () => void
  onNext: (data: {
    method: ReceiveMethod
    amount: number
    mintUrl: string
    ecashRequest?: string
    ecashRequestId?: string
    httpEndpoint?: string
  }) => void
  initialAmount?: number
  initialMintUrl?: string | null
  isLoading?: boolean
}

export function ReceiveInputStep({
  onBack,
  onNext,
  initialAmount = 0,
  initialMintUrl,
  isLoading = false,
}: ReceiveInputStepProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const addToast = useAppStore((s) => s.addToast)

  // State
  const [method, setMethod] = useState<ReceiveMethod>('lightning')
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

  // Handle next
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

    if (method === 'ecash') {
      if (!userNprofile) {
        hapticError()
        addToast({ type: 'error', message: t('errors.generic'), duration: 3000 })
        return
      }

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

        onNext({
          method: 'ecash',
          amount: numericAmount,
          mintUrl: selectedMintUrl,
          ecashRequest: result.request,
          ecashRequestId: result.id,
          httpEndpoint: result.httpEndpoint,
        })
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

        onNext({
          method: 'ecash',
          amount: numericAmount,
          mintUrl: selectedMintUrl,
          ecashRequest: result.request,
          ecashRequestId: result.id,
        })
      }
    } else {
      onNext({
        method: 'lightning',
        amount: numericAmount,
        mintUrl: selectedMintUrl,
      })
    }
  }, [method, amount, memo, selectedMintUrl, userNprofile, supportsHttp, onNext, addToast, t])

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
        {/* Method Tabs — segment control */}
        <div className="space-y-2">
          <p className="text-label font-normal text-foreground-muted leading-snug">
            {t('receive.senderMethod')}
          </p>
          <div className="relative flex p-1.5 bg-muted rounded-[14px]">
            {/* Sliding indicator */}
            <div
              className="absolute top-1.5 bottom-1.5 w-[calc(50%-3px)] bg-brand rounded-[10px] shadow-sm transition-transform duration-250 ease-out"
              style={{ left: '6px', transform: method === 'ecash' ? 'translateX(100%)' : 'translateX(0)' }}
            />
            <button
              onClick={() => { setMethod('lightning'); hapticTap() }}
              className={`relative z-10 flex-1 py-2.5 rounded-[10px] font-medium text-caption transition-colors duration-200 min-h-[44px] ${
                method === 'lightning' ? 'text-white' : 'text-foreground-muted'
              }`}
            >
              {t('receive.lightning')}
            </button>
            <button
              onClick={() => { setMethod('ecash'); hapticTap() }}
              className={`relative z-10 flex-1 py-2.5 rounded-[10px] font-medium text-caption transition-colors duration-200 min-h-[44px] ${
                method === 'ecash' ? 'text-white' : 'text-foreground-muted'
              }`}
            >
              {t('receive.ecash')}
            </button>
          </div>
        </div>

        {/* Amount */}
        <AmountInput
          amount={amount}
          onAmountChange={setAmount}
          label={t('receive.howMuch')}
        />

        {/* Memo — optional, only for ecash */}
        {method === 'ecash' && (
          <div>
            <p className="text-label text-foreground-muted leading-snug">{t('receive.memoPlaceholder')}</p>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={100}
              className="w-full bg-transparent border-0 border-b border-b-border rounded-none py-2 text-subtitle font-semibold text-foreground focus:outline-none focus:border-b-foreground transition-colors"
            />
          </div>
        )}
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
