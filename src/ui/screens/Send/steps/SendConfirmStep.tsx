/**
 * SendConfirmStep — Confirmation screen before sending
 * Figma 275:128: question text at top 1/3, flat detail panel near bottom, button at very bottom
 */

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { hapticTap } from '@/utils/haptic'
import { useFormatSats, useFormatFiat, FIAT_CURRENCY_MAP } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { useRouting, PaymentRoute } from '@/ui/hooks/use-routing'
import type { SendableValidatedData } from '../SendFlow'

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
  /** Display name from address book (overrides default recipient display) */
  displayName?: string
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
  displayName?: string,
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
        recipient: displayName || data.address,
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
  displayName,
}: SendConfirmStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName } = useMintMetadata(settings.mints)
  const routing = useRouting()

  // Async fee estimation for my-wallet transfers
  const [estimatedFee, setEstimatedFee] = useState<number | null>(
    validatedData.type === 'my-wallet' ? null : initialFee
  )
  const [feeLoading, setFeeLoading] = useState(validatedData.type === 'my-wallet')
  const [feeError, setFeeError] = useState(false)

  const targetMintUrl = validatedData.type === 'my-wallet' ? validatedData.targetMintUrl : null

  useEffect(() => {
    if (!targetMintUrl) return

    let cancelled = false

    async function estimateFee() {
      try {
        const estimate = await routing.estimateMyWalletFee(mintUrl, targetMintUrl!, amount)
        if (!cancelled) {
          setEstimatedFee(estimate.fee)
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
    return () => { cancelled = true }
  }, [targetMintUrl, amount, mintUrl, routing])

  const fee = estimatedFee ?? 0
  const display = getConfirmDisplayInfo(validatedData, route, t, displayName)
  const { method, recipient: recipientName, recipientDetail, memo: displayMemo } = display
  const memo = userMemo || displayMemo
  const mintName = getDisplayName(mintUrl)
  const totalAmount = amount + fee

  const isMyWallet = validatedData.type === 'my-wallet'

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('send.confirm.title')} onBack={onBack} />

      {/* Centered content — flowing sentence like Toss */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="text-center">
          <p className="text-heading font-semibold whitespace-pre-line">
            <Trans
              i18nKey={isMyWallet ? "send.confirm.fullTransferQuestion" : "send.confirm.fullQuestion"}
              values={{
                mint: mintName,
                recipient: recipientName.includes('@') ? recipientName.split('@')[0] : recipientName,
                amount: isFiatMode && fiatAmount
                  ? `${FIAT_CURRENCY_MAP.get(settings.fiatCurrency ?? 'USD')?.symbol ?? ''}${Number(fiatAmount).toLocaleString()}`
                  : formatSats(amount),
                target: isMyWallet ? (validatedData as { targetMintName: string }).targetMintName : '',
              }}
              components={{ b: <span className="text-brand" /> }}
            />
          </p>
          {(isFiatMode || formatFiat(amount)) && (
            <p className="text-body text-foreground-muted mt-3">
              {isFiatMode ? formatSats(amount) : formatFiat(amount)}
            </p>
          )}
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
