/**
 * SendConfirmStep — Confirmation screen before sending
 * Figma 275:128: question text at top 1/3, flat detail panel near bottom, button at very bottom
 */

import { useState, useEffect } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { hapticTap } from '@/utils/haptic'
import { useFormatSats, useFormatFiat, FIAT_CURRENCY_MAP } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { createMintQuote, prepareMelt, rollbackMelt } from '@/coco/cashuService'
import type { SendableValidatedData } from '../SendFlow'
import { PaymentRoute } from '@/services/payment/routing'

interface SendConfirmStepProps {
  onBack: () => void
  onConfirm: () => void
  validatedData: SendableValidatedData
  amount: number
  fee: number
  mintUrl: string
  error: string | null
  route?: PaymentRoute
  isFiatMode?: boolean
  fiatAmount?: string
  userMemo?: string
}

interface ConfirmDisplayInfo {
  method: string
  recipient: string
  recipientDetail: string
  memo?: string
}

function getConfirmDisplayInfo(
  data: SendableValidatedData,
  route: PaymentRoute | undefined,
  t: (key: string) => string,
): ConfirmDisplayInfo {
  // Route-aware: unified QR에서 LN 라우트가 선택되면 lightning invoice 기반 표시
  const isLnRoute = route === PaymentRoute.LN_INTERNAL || route === PaymentRoute.LN_CROSS_MINT || route === PaymentRoute.MELT_TO_LN
  const isTokenRoute = route === PaymentRoute.TOKEN_TRANSFER || route === PaymentRoute.OWN_MINT_TOKEN || route === PaymentRoute.MINT_AND_DM

  if (isLnRoute && data.type === 'cashu-request' && data.parsed.lightningInvoice) {
    const inv = data.parsed.lightningInvoice
    return {
      method: 'Lightning',
      recipient: t('send.confirm.lightningInvoice'),
      recipientDetail: `${inv.slice(0, 12).toLowerCase()}...${inv.slice(-4).toLowerCase()}`,
      memo: data.parsed.description,
    }
  }

  if (isTokenRoute && data.type === 'cashu-request') {
    const req = data.request
    return {
      method: 'eCash',
      recipient: t('send.confirm.ecashRequest'),
      recipientDetail: `${req.slice(0, 8)}...${req.slice(-4)}`,
      memo: data.parsed.description,
    }
  }

  switch (data.type) {
    case 'bolt11': {
      const inv = data.invoice
      return {
        method: 'Lightning',
        recipient: data.description || t('send.confirm.lightningInvoice'),
        recipientDetail: `${inv.slice(0, 8)}...${inv.slice(-4)}`,
        memo: data.description,
      }
    }
    case 'lightning-address':
      return {
        method: 'Lightning',
        recipient: data.address,
        recipientDetail: data.address,
      }
    case 'lnurl-pay':
      return {
        method: 'Lightning',
        recipient: data.params?.domain || 'LNURL',
        recipientDetail: data.params?.domain || 'LNURL',
      }
    case 'cashu-request': {
      // fallback (route 없을 때)
      const req = data.request
      return {
        method: 'eCash',
        recipient: t('send.confirm.ecashRequest'),
        recipientDetail: `${req.slice(0, 8)}...${req.slice(-4)}`,
        memo: data.parsed.description,
      }
    }
    case 'my-wallet':
      return {
        method: t('send.confirm.internalTransfer'),
        recipient: data.targetMintName,
        recipientDetail: `${data.targetMintUrl.slice(0, 20)}...`,
      }
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
  route,
  isFiatMode = false,
  fiatAmount,
  userMemo,
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
        await rollbackMelt(meltOp.operationId, 'fee estimation only').catch((e) =>
          console.error('[SendConfirmStep] Fee estimation rollback FAILED:', e)
        )
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
        rollbackMelt(pendingOperationId, 'cleanup on unmount').catch((e) =>
          console.error('[SendConfirmStep] Unmount rollback FAILED:', e)
        )
      }
    }
  }, [targetMintUrl, amount, mintUrl])

  const fee = estimatedFee ?? 0
  const display = getConfirmDisplayInfo(validatedData, route, t)
  const { method, recipientDetail, memo: displayMemo } = display
  const memo = userMemo || displayMemo
  const mintName = getDisplayName(mintUrl)
  const totalAmount = amount + fee

  const isMyWallet = validatedData.type === 'my-wallet'

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">{t('send.confirm.title')}</h1>
        <div className="w-10" />
      </header>

      {/* Centered content — flowing sentence like Toss */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="text-center">
          <p className="text-heading font-semibold whitespace-pre-line">
            <Trans
              i18nKey={isMyWallet ? "send.confirm.fullTransferQuestion" : "send.confirm.fullQuestion"}
              values={{
                mint: mintName,
                recipient: recipientDetail.includes('@') ? recipientDetail.split('@')[0] : recipientDetail,
                amount: isFiatMode && fiatAmount
                  ? `${FIAT_CURRENCY_MAP.get(settings.fiatCurrency ?? 'USD')?.symbol ?? ''}${Number(fiatAmount).toLocaleString()}`
                  : formatSats(amount),
                target: isMyWallet ? (validatedData as { targetMintName: string }).targetMintName : '',
              }}
              components={{ b: <span className="text-brand" /> }}
            />
          </p>
          <p className="text-body text-foreground-muted mt-3">
            {isFiatMode ? formatSats(amount) : (formatFiat(amount) || '')}
          </p>
        </div>
      </div>

      {/* Detail rows + button at bottom */}
      <div className="px-6 pb-6 pb-safe shrink-0">
        {/* Detail rows */}
        <div className="mb-4">
          {/* 메모 */}
          {memo && (
            <div className="flex justify-between py-2.5 border-b border-border/50">
              <span className="text-body text-foreground-muted">{t('send.confirm.memo')}</span>
              <span className="text-body font-medium text-foreground truncate max-w-[200px]">{memo}</span>
            </div>
          )}
          {/* 전송 방식 */}
          <div className="flex justify-between py-2.5 border-b border-border/50">
            <span className="text-body text-foreground-muted">{t('send.confirm.method')}</span>
            <span className="text-body font-medium text-foreground">{method}</span>
          </div>
          {/* 출금 지갑 */}
          <div className="flex justify-between py-2.5 border-b border-border/50">
            <span className="text-body text-foreground-muted">{t('send.confirm.sourceMint')}</span>
            <span className="text-body font-medium text-foreground truncate max-w-[200px]">{mintName}</span>
          </div>
          {/* 받는이 */}
          {isMyWallet ? (
            <div className="flex justify-between py-2.5 border-b border-border/50">
              <span className="text-body text-foreground-muted">{t('send.confirm.targetWallet')}</span>
              <span className="text-body font-medium text-foreground truncate max-w-[200px]">{validatedData.targetMintName}</span>
            </div>
          ) : recipientDetail ? (
            <div className="flex justify-between py-2.5 border-b border-border/50">
              <span className="text-body text-foreground-muted">{t('send.confirm.recipient')}</span>
              <span className="text-body font-medium text-foreground truncate max-w-[200px]">{recipientDetail}</span>
            </div>
          ) : null}
          {/* Fee section */}
          {feeLoading ? (
            <div className="flex justify-between py-2.5 border-b border-border/50">
              <span className="text-body text-foreground-muted">{t('send.confirm.estimatedFee')}</span>
              <Loader2 className="w-4 h-4 text-foreground-muted animate-spin" />
            </div>
          ) : fee > 0 ? (
            <>
              <div className="flex justify-between py-2.5 border-b border-border/50">
                <span className="text-body text-foreground-muted">{t('send.confirm.estimatedFee')}</span>
                <span className="text-body font-medium text-foreground">{formatSats(fee)}</span>
              </div>
              <div className="flex justify-between py-2.5">
                <span className="text-body font-bold text-foreground">{t('send.confirm.total')}</span>
                <div className="text-right">
                  <span className="text-body font-bold text-foreground">{formatSats(totalAmount)}</span>
                  {formatFiat(totalAmount) && (
                    <p className="text-body text-foreground-muted">{formatFiat(totalAmount)}</p>
                  )}
                </div>
              </div>
            </>
          ) : feeError ? (
            <div className="flex justify-between py-2.5 border-b border-border/50">
              <span className="text-body text-foreground-muted">{t('send.confirm.estimatedFee')}</span>
              <span className="text-body text-foreground-muted">{t('send.confirm.feeEstimateFailed')}</span>
            </div>
          ) : null}
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 bg-accent-danger/10 rounded-xl text-accent-danger text-caption mb-4">
            {error}
          </div>
        )}

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
