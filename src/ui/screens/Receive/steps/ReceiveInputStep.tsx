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
import { createNostrPaymentRequest } from '@/services/cashu/nut18'
import { encodeNprofile } from '@/services/crypto'
import type { ReceiveMethod } from '../ReceiveFlow'

interface ReceiveInputStepProps {
  onBack: () => void
  onNext: (data: {
    method: ReceiveMethod
    amount: number
    mintUrl: string
    ecashRequest?: string
    ecashRequestId?: string
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
    } else {
      onNext({
        method: 'lightning',
        amount: numericAmount,
        mintUrl: selectedMintUrl,
      })
    }
  }, [method, amount, memo, selectedMintUrl, userNprofile, onNext, addToast, t])

  return (
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Header */}
      <header className="relative flex items-center px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center z-10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-lg font-semibold pointer-events-none">
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
      <div className="flex-1 overflow-y-auto px-6 space-y-10">
        {/* Method Tabs — segment control */}
        <div className="space-y-2">
          <p className="text-[20px] font-normal text-foreground-muted leading-snug">
            {t('receive.senderMethod')}
          </p>
          <div className="relative flex p-1.5 bg-[#f0f0f0] rounded-[14px]">
            {/* Sliding indicator */}
            <div
              className="absolute top-1.5 bottom-1.5 w-[calc(50%-3px)] bg-[#3b7df5] rounded-[10px] shadow-sm transition-transform duration-250 ease-out"
              style={{ left: '6px', transform: method === 'ecash' ? 'translateX(100%)' : 'translateX(0)' }}
            />
            <button
              onClick={() => { setMethod('lightning'); hapticTap() }}
              className={`relative z-10 flex-1 py-2.5 rounded-[10px] font-medium text-sm transition-colors duration-200 min-h-[44px] ${
                method === 'lightning' ? 'text-white' : 'text-foreground-muted'
              }`}
            >
              {t('receive.lightning')}
            </button>
            <button
              onClick={() => { setMethod('ecash'); hapticTap() }}
              className={`relative z-10 flex-1 py-2.5 rounded-[10px] font-medium text-sm transition-colors duration-200 min-h-[44px] ${
                method === 'ecash' ? 'text-white' : 'text-foreground-muted'
              }`}
            >
              {t('receive.ecash')}
            </button>
          </div>
        </div>

        {/* Amount */}
        <div>
          <p className="text-[20px] font-normal text-foreground-muted leading-snug">{t('receive.howMuch')}</p>
          <div className="relative">
            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-foreground-muted font-medium text-[22px]">₿</span>
            <input
              type="text"
              inputMode="numeric"
              value={amount ? Number(amount).toLocaleString() : '0'}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
              onFocus={(e) => { if (!amount) e.target.select() }}
              className={`w-full bg-transparent border-0 border-b border-b-gray-200 rounded-none pl-8 py-2 text-[22px] font-bold focus:outline-none focus:border-b-foreground transition-colors ${amount ? 'text-foreground' : 'text-foreground-muted/40'}`}
            />
          </div>
        </div>

        {/* Memo — optional, only for ecash */}
        {method === 'ecash' && (
          <div>
            <p className="text-[16px] font-normal text-foreground-muted leading-snug">{t('receive.memoPlaceholder')}</p>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={100}
              className="w-full bg-transparent border-0 border-b border-b-gray-200 rounded-none py-2 text-[18px] font-normal text-foreground focus:outline-none focus:border-b-foreground transition-colors"
            />
          </div>
        )}
      </div>

      {/* Bottom Action */}
      <div className="p-5 pb-safe">
        <Button
          variant="primary"
          size="xl"
          onClick={handleNext}
          loading={isLoading}
          className="w-full !bg-[#3b7df5] !text-white !rounded-[14px] !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {t('receive.next')}
        </Button>
      </div>
    </div>
  )
}
