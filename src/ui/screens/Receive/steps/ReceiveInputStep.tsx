/**
 * ReceiveInputStep — Main input for receive flow
 * Method tab (Lightning/eCash), mint selection, amount input, token receive button
 * Modern layout: bg-[#faf9f6], Toss underline inputs, no border-t
 */

import { useState, useCallback, useMemo } from 'react'
import { ArrowLeft, Zap, Banknote } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useWallet } from '@/hooks/use-wallet'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { hapticTap, hapticError } from '@/utils/haptic'
import { formatSats } from '@/utils/format'
import { MintSelectBottomSheet, TokenReceiveBottomSheet } from '@/ui/components/payment'
import { Button } from '@/ui/components/common/Button'
import { createNostrPaymentRequest } from '@/services/cashu/nut18'
import { encodeNprofile } from '@/services/crypto'
import type { ReceiveMethod } from '../ReceiveFlow'
import type { ValidatedCashuToken } from '@/ui/components/scanner/InputValidator'

interface ReceiveInputStepProps {
  onBack: () => void
  onNext: (data: {
    method: ReceiveMethod
    amount: number
    mintUrl: string
    ecashRequest?: string
    ecashRequestId?: string
  }) => void
  onTokenDetected: (token: ValidatedCashuToken) => void
  initialAmount?: number
  initialMintUrl?: string | null
  isLoading?: boolean
}

export function ReceiveInputStep({
  onBack,
  onNext,
  onTokenDetected,
  initialAmount = 0,
  initialMintUrl,
  isLoading = false,
}: ReceiveInputStepProps) {
  const { t } = useTranslation()
  const { balance } = useWallet()
  const settings = useAppStore((s) => s.settings)
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const addToast = useAppStore((s) => s.addToast)
  const { getDisplayName } = useMintMetadata(settings.mints)

  // State
  const [method, setMethod] = useState<ReceiveMethod>('lightning')
  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(
    initialMintUrl || settings.mints[0] || null
  )
  const [memo, setMemo] = useState('')
  const [showMintSelect, setShowMintSelect] = useState(false)
  const [showTokenReceive, setShowTokenReceive] = useState(false)

  const mintBalance = selectedMintUrl ? (balance.byMint[selectedMintUrl] || 0) : 0
  const mintName = selectedMintUrl ? getDisplayName(selectedMintUrl) : ''

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
      // Create NUT-18 payment request here (sync operation)
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
      {/* Header — no border */}
      <header className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">{t('receive.title')}</h1>
        <button
          onClick={() => {
            hapticTap()
            setShowTokenReceive(true)
          }}
          className="text-sm text-accent-primary font-medium min-h-[44px] px-2 flex items-center justify-center rounded-lg hover:bg-black/5 active:bg-black/10 transition-colors"
        >
          {t('receive.receiveToken')}
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pt-10 space-y-12">
        {/* Mint — narrative text + change button on right */}
        <div>
          <div className="flex items-center justify-between">
            <p className="text-[22px] leading-snug">
              <span className="font-normal">{t('receive.toMintPrefix')}</span>
              <span className="font-bold">{mintName || t('payment.selectMint')}</span>
              <span className="font-normal text-foreground-muted">{t('receive.toMintSuffix')}</span>
            </p>
            <button
              onClick={() => setShowMintSelect(true)}
              className="text-sm text-accent-primary font-medium px-3 py-1.5 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] flex items-center shrink-0"
            >
              {t('common.change')}
            </button>
          </div>
          <p className="text-[15px] text-foreground-muted mt-1">{t('common.balance')} {formatSats(mintBalance)}</p>
        </div>

        {/* Method Tabs */}
        <div className="space-y-2">
          <p className="text-[15px] font-medium text-foreground-muted">
            {t('receive.senderMethod')}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { setMethod('lightning'); hapticTap() }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all min-h-[44px] ${
                method === 'lightning'
                  ? 'bg-[#3b7df5] text-white shadow-sm'
                  : 'bg-[#f0f0f0] text-foreground-muted'
              }`}
            >
              <Zap className="w-4 h-4" />
              {t('receive.lightning')}
            </button>
            <button
              onClick={() => { setMethod('ecash'); hapticTap() }}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-medium text-sm transition-all min-h-[44px] ${
                method === 'ecash'
                  ? 'bg-[#3b7df5] text-white shadow-sm'
                  : 'bg-[#f0f0f0] text-foreground-muted'
              }`}
            >
              <Banknote className="w-4 h-4" />
              {t('receive.ecash')}
            </button>
          </div>
        </div>

        {/* Amount — question as input placeholder */}
        <div className="relative">
          {amount && <span className="absolute left-0 top-1/2 -translate-y-1/2 text-foreground-muted font-medium text-[22px]">₿</span>}
          <input
            type="text"
            inputMode="numeric"
            value={amount ? Number(amount).toLocaleString() : ''}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder={t('receive.howMuch')}
            className={`w-full bg-transparent border-0 border-b border-b-gray-200 rounded-none py-2 text-[22px] focus:outline-none focus:border-b-foreground transition-colors ${amount ? 'pl-8 font-bold text-foreground' : 'pl-0 font-normal text-foreground placeholder:text-foreground-muted/40'}`}
          />
        </div>

        {/* Memo — optional, only for ecash */}
        {method === 'ecash' && (
          <div>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder={t('receive.memoPlaceholder')}
              maxLength={100}
              className="w-full bg-transparent border-0 border-b border-b-gray-200 rounded-none py-2 text-[18px] font-normal text-foreground placeholder:text-foreground-muted/40 focus:outline-none focus:border-b-foreground transition-colors"
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
          className="w-full !bg-[#3b7df5] !text-white !rounded-lg !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {t('receive.next')}
        </Button>
      </div>

      {/* Mint Select */}
      <MintSelectBottomSheet
        isOpen={showMintSelect}
        onClose={() => setShowMintSelect(false)}
        onSelect={setSelectedMintUrl}
        selectedMintUrl={selectedMintUrl}
      />

      {/* Token Receive Bottom Sheet */}
      <TokenReceiveBottomSheet
        isOpen={showTokenReceive}
        onClose={() => setShowTokenReceive(false)}
        onTokenDetected={onTokenDetected}
      />
    </div>
  )
}
