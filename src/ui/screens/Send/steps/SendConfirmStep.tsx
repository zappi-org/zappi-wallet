/**
 * SendConfirmStep — Confirmation screen before sending
 * Figma 275:128: question text at top 1/3, flat detail panel near bottom, button at very bottom
 */

import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { hapticTap } from '@/utils/haptic'
import { formatSats } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
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
  }
}

function getMethodLabel(type: SendableValidatedData['type']): string {
  switch (type) {
    case 'bolt11':
    case 'lightning-address':
    case 'lnurl-pay':
      return 'Lightning'
    case 'cashu-request':
      return 'eCash'
  }
}

export function SendConfirmStep({
  onBack,
  onConfirm,
  validatedData,
  amount,
  fee,
  mintUrl,
  error,
}: SendConfirmStepProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName } = useMintMetadata(settings.mints)

  const recipient = getRecipientDisplay(validatedData, t)
  const recipientDetail = getRecipientDetail(validatedData)
  const method = getMethodLabel(validatedData.type)
  const mintName = getDisplayName(mintUrl)
  const totalAmount = amount + fee
  const memo = validatedData.type === 'bolt11' ? validatedData.description
    : validatedData.type === 'cashu-request' ? validatedData.parsed.description
    : undefined

  return (
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Header — no border */}
      <header className="relative flex items-center px-4 py-3">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 rounded-lg hover:bg-black/5 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center z-10"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-lg font-semibold pointer-events-none">{t('send.confirm.title')}</h1>
      </header>

      {/* Question text — upper area, Toss style */}
      <div className="flex-1 flex flex-col px-6">
        <div className="pt-16 text-center space-y-1">
          <p className="text-[24px] leading-snug">
            <span className="font-bold text-[#3b7df5]">{recipient}</span>
            <span className="font-medium">{t('send.confirm.toSuffix')}</span>
          </p>
          <p className="text-[24px] font-bold leading-snug">
            {formatSats(amount)} {t('send.confirm.amountSuffix')}
          </p>
          <p className="text-[24px] font-medium leading-snug">
            {t('send.confirm.questionEnd')}
          </p>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Detail rows — flat, no card background */}
        <div className="space-y-4 mb-4 px-1">
          <div className="flex items-center justify-between">
            <span className="text-[15px] text-foreground-muted">{t('send.confirm.method')}</span>
            <span className="text-[15px] font-semibold">{method}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[15px] text-foreground-muted">{t('send.confirm.sourceMint')}</span>
            <span className="text-[15px] font-semibold truncate max-w-[200px]">{mintName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[15px] text-foreground-muted">{t('send.confirm.recipient')}</span>
            <span className="text-[15px] font-semibold truncate max-w-[200px]">{recipientDetail}</span>
          </div>
          {memo && (
            <div className="flex items-center justify-between">
              <span className="text-[15px] text-foreground-muted">{t('send.confirm.memo')}</span>
              <span className="text-[15px] font-semibold truncate max-w-[200px]">{memo}</span>
            </div>
          )}
          {fee > 0 && (
            <>
              <div className="border-t border-black/5" />
              <div className="flex items-center justify-between">
                <span className="text-[15px] text-foreground-muted">{t('send.confirm.estimatedFee')}</span>
                <span className="text-[15px] font-semibold">{formatSats(fee)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold">{t('send.confirm.total')}</span>
                <span className="text-[15px] font-bold">{formatSats(totalAmount)}</span>
              </div>
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 bg-accent-danger/10 rounded-xl text-accent-danger text-sm mb-4">
            {error}
          </div>
        )}
      </div>

      {/* Bottom Action — no border-t */}
      <div className="p-5 pb-safe">
        <Button
          variant="primary"
          size="xl"
          onClick={() => {
            hapticTap()
            onConfirm()
          }}
          className="w-full !bg-[#3b7df5] !text-white !rounded-[14px] !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {t('send.confirm.send')}
        </Button>
      </div>
    </div>
  )
}
