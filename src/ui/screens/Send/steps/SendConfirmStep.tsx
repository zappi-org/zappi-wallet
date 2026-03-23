/**
 * SendConfirmStep — Confirmation screen before sending
 * Figma 275:128: question text at top 1/3, flat detail panel near bottom, button at very bottom
 */

import { useState, useEffect } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { hapticTap } from '@/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { createMintQuote, prepareMelt, rollbackMelt } from '@/coco/cashuService'
import type { SendableValidatedData } from '../SendFlow'

interface SendConfirmStepProps {
  onBack: () => void
  onConfirm: () => void
  validatedData: SendableValidatedData
  amount: number
  fee: number
  mintUrl: string
  error: string | null
}

function getRecipientDisplay(data: SendableValidatedData, t: (key: string) => string): string {
  switch (data.type) {
    case 'bolt11':
      return data.description || t('send.confirm.lightningInvoice')
    case 'lightning-address':
      return data.address
    case 'lnurl-pay':
      return data.params?.domain || 'LNURL'
    case 'cashu-request':
      return t('send.confirm.ecashRequest')
    case 'my-wallet':
      return data.targetMintName
  }
}

function getRecipientDetail(data: SendableValidatedData): string {
  switch (data.type) {
    case 'bolt11': {
      const inv = data.invoice
      return `${inv.slice(0, 8)}...${inv.slice(-4)}`
    }
    case 'lightning-address':
      return data.address
    case 'lnurl-pay':
      return data.params?.domain || 'LNURL'
    case 'cashu-request': {
      const req = data.request
      return `${req.slice(0, 8)}...${req.slice(-4)}`
    }
    case 'my-wallet': {
      const url = data.targetMintUrl
      return `${url.slice(0, 20)}...`
    }
  }
}

function getMethodLabel(type: SendableValidatedData['type'], t: (key: string) => string): string {
  switch (type) {
    case 'bolt11':
    case 'lightning-address':
    case 'lnurl-pay':
      return 'Lightning'
    case 'cashu-request':
      return 'eCash'
    case 'my-wallet':
      return t('send.confirm.internalTransfer')
  }
}

export function SendConfirmStep({
  onBack,
  onConfirm,
  validatedData,
  amount,
  fee: initialFee,
  mintUrl,
  error,
}: SendConfirmStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName } = useMintMetadata(settings.mints)

  // Async fee estimation for my-wallet transfers
  const [estimatedFee, setEstimatedFee] = useState<number | null>(
    validatedData.type === 'my-wallet' ? null : initialFee
  )
  const [feeLoading, setFeeLoading] = useState(validatedData.type === 'my-wallet')
  const [feeError, setFeeError] = useState(false)

  const targetMintUrl = validatedData.type === 'my-wallet' ? validatedData.targetMintUrl : null

  useEffect(() => {
    if (!targetMintUrl) return
    const target = targetMintUrl // narrow for closure

    let cancelled = false
    let pendingOperationId: string | null = null

    async function estimateFee() {
      try {
        const mintQuote = await createMintQuote(target, amount)
        const meltOp = await prepareMelt(mintUrl, mintQuote.request)
        pendingOperationId = meltOp.operationId
        const fee = meltOp.fee_reserve + meltOp.swap_fee
        await rollbackMelt(meltOp.operationId, 'fee estimation only').catch(() => {})
        pendingOperationId = null
        if (!cancelled) {
          setEstimatedFee(fee)
          setFeeLoading(false)
        }
      } catch (err) {
        console.warn('[SendConfirmStep] Fee estimation failed:', err)
        if (!cancelled) {
          setEstimatedFee(0)
          setFeeLoading(false)
          setFeeError(true)
        }
      }
    }

    estimateFee()
    return () => {
      cancelled = true
      if (pendingOperationId) {
        rollbackMelt(pendingOperationId, 'cleanup on unmount').catch(() => {})
      }
    }
  }, [targetMintUrl, amount, mintUrl])

  const fee = estimatedFee ?? 0
  const recipient = getRecipientDisplay(validatedData, t)
  const recipientDetail = getRecipientDetail(validatedData)
  const method = getMethodLabel(validatedData.type, t)
  const mintName = getDisplayName(mintUrl)
  const totalAmount = amount + fee
  const memo = validatedData.type === 'bolt11' ? validatedData.description
    : validatedData.type === 'cashu-request' ? validatedData.parsed.description
    : undefined

  const isMyWallet = validatedData.type === 'my-wallet'

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — no border */}
      <header className="relative flex items-center px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 rounded-lg hover:bg-background-hover transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center z-10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle pointer-events-none">{t('send.confirm.title')}</h1>
      </header>

      {/* Question text — upper area, Toss style */}
      <div className="flex-1 flex flex-col px-6">
        <div className="pt-16 text-center space-y-1">
          <p className="text-amount-lg leading-snug">
            <span className="font-bold text-brand">{recipient}</span>
            <span className="font-medium">{t('send.confirm.toSuffix')}</span>
          </p>
          <p className="text-amount-lg font-bold leading-snug">
            {formatSats(amount)} {t('send.confirm.amountSuffix')}
          </p>
          {formatFiat(amount) && (
            <p className="text-body text-foreground-muted">{formatFiat(amount)}</p>
          )}
          <p className="text-amount-lg font-medium leading-snug">
            {isMyWallet ? t('send.confirm.transferQuestionEnd') : t('send.confirm.questionEnd')}
          </p>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Detail rows — flat, no card background */}
        <div className="space-y-3 mb-4 px-1">
          <div className="flex items-center justify-between">
            <span className="text-body text-foreground-muted">{t('send.confirm.method')}</span>
            <span className="text-body font-semibold">{method}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-body text-foreground-muted">{t('send.confirm.sourceMint')}</span>
            <span className="text-body font-semibold truncate max-w-[200px]">{mintName}</span>
          </div>
          {isMyWallet && (
            <div className="flex items-center justify-between">
              <span className="text-body text-foreground-muted">{t('send.confirm.targetWallet')}</span>
              <span className="text-body font-semibold truncate max-w-[200px]">{validatedData.targetMintName}</span>
            </div>
          )}
          {!isMyWallet && (
            <div className="flex items-center justify-between">
              <span className="text-body text-foreground-muted">{t('send.confirm.recipient')}</span>
              <span className="text-body font-semibold truncate max-w-[200px]">{recipientDetail}</span>
            </div>
          )}
          {memo && (
            <div className="flex items-center justify-between">
              <span className="text-body text-foreground-muted">{t('send.confirm.memo')}</span>
              <span className="text-body font-semibold truncate max-w-[200px]">{memo}</span>
            </div>
          )}
          {/* Fee section */}
          {feeLoading ? (
            <>
              <div className="border-t border-border" />
              <div className="flex items-center justify-between">
                <span className="text-body text-foreground-muted">{t('send.confirm.estimatedFee')}</span>
                <Loader2 className="w-4 h-4 text-foreground-muted animate-spin" />
              </div>
            </>
          ) : fee > 0 ? (
            <>
              <div className="border-t border-border" />
              <div className="flex items-center justify-between">
                <span className="text-body text-foreground-muted">{t('send.confirm.estimatedFee')}</span>
                <span className="text-body font-semibold">{formatSats(fee)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-body font-semibold">{t('send.confirm.total')}</span>
                <div className="text-right">
                  <span className="text-body font-bold">{formatSats(totalAmount)}</span>
                  {formatFiat(totalAmount) && (
                    <p className="text-caption text-foreground-muted">{formatFiat(totalAmount)}</p>
                  )}
                </div>
              </div>
            </>
          ) : feeError ? (
            <>
              <div className="border-t border-border" />
              <div className="flex items-center justify-between">
                <span className="text-body text-foreground-muted">{t('send.confirm.estimatedFee')}</span>
                <span className="text-caption text-foreground-muted">{t('send.confirm.feeEstimateFailed')}</span>
              </div>
            </>
          ) : null}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 bg-accent-danger/10 rounded-xl text-accent-danger text-caption mb-4">
            {error}
          </div>
        )}
      </div>

      {/* Bottom Action — no border-t */}
      <div className="p-4 pb-safe">
        <Button
          variant="brand"
          size="xl"
          onClick={() => {
            hapticTap()
            onConfirm()
          }}
          disabled={feeLoading}
          className="w-full"
        >
          {isMyWallet ? t('send.confirm.transfer') : t('send.confirm.send')}
        </Button>
      </div>
    </div>
  )
}
