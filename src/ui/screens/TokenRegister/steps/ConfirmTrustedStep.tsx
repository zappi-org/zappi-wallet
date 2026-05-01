import zappiLogo from '@/assets/zappi.png'
import type { ValidatedCashuToken } from '@/core/domain/input-types'
import { useAppStore } from '@/store'
import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { Button } from '@/ui/components/common/Button'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useWallet } from '@/ui/hooks/use-wallet'
import { translateError } from '@/ui/utils/error-i18n'
import { hapticError } from '@/ui/utils/haptic'
import { useFormatFiat, useFormatSats } from '@/utils/format'
import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface ConfirmTrustedStepProps {
  token: ValidatedCashuToken
  onBack: () => void
  onReceive: (receiveMintUrl: string) => Promise<void>
  onEstimateRedeemFee?: (
    token: string,
  ) => Promise<{ grossAmount: number; fee: number; netAmount: number } | null>
}

/** Memo font size heuristic — 6-tier gradual shrink 20→13px (~160px box) */
function memoFontSizeFor(memo: string): number {
  const len = memo.length
  if (len > 20) return 13
  if (len > 16) return 14
  if (len > 13) return 15
  if (len > 11) return 16
  if (len > 9) return 18
  return 20
}

export function ConfirmTrustedStep({
  token,
  onBack,
  onReceive,
  onEstimateRedeemFee,
}: ConfirmTrustedStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const { balance } = useWallet()
  const addToast = useAppStore((s) => s.addToast)

  const sourceMintUrl = token.mintUrl
  const amount = token.amountSats
  const memo = token.memo ?? ''

  const [receiveMintUrl, setReceiveMintUrl] = useState(sourceMintUrl)
  const [mintSheetOpen, setMintSheetOpen] = useState(false)

  const mintUrls = useMemo(() => [sourceMintUrl, receiveMintUrl], [sourceMintUrl, receiveMintUrl])
  const { getDisplayName, getIconUrl, getMetadata } = useMintMetadata(mintUrls)
  const sourceMintName = getDisplayName(sourceMintUrl)
  const sourceMintSubName = getMetadata(sourceMintUrl)?.name
  const sourceMintIconUrl = getIconUrl(sourceMintUrl)
  const receiveMintName = getDisplayName(receiveMintUrl)
  const receiveMintBalance = balance.byMint[receiveMintUrl] ?? 0
  const isSwap = receiveMintUrl !== sourceMintUrl

  const [fee, setFee] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isSwap || !onEstimateRedeemFee) {
      // Swap fee is mint-pair dependent and not quoted here; hide line instead.
      setFee(null)
      return
    }
    let cancelled = false
    onEstimateRedeemFee(token.token)
      .then((estimate) => {
        if (!cancelled && estimate) setFee(estimate.fee)
      })
      .catch(() => {
        /* ignore; UI shows fee as '—' */
      })
    return () => {
      cancelled = true
    }
  }, [token.token, onEstimateRedeemFee, isSwap])

  const netAmount = fee !== null ? Math.max(0, amount - fee) : amount
  const fiatLabel = formatFiat(amount)
  const memoFontSize = memo ? memoFontSizeFor(memo) : 21

  const handleReceive = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      await onReceive(receiveMintUrl)
    } catch (error) {
      hapticError()
      addToast({ type: 'error', message: translateError(error, t) })
    } finally {
      setBusy(false)
    }
  }, [busy, onReceive, receiveMintUrl, addToast, t])

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title={t('receive.token.title')} onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 pt-2">
        <h2 className="pt-[4dvh] text-heading font-semibold text-foreground text-center">
          {t('tokenRegister.arrived')}
        </h2>

        {/* Hero card — fixed min-height, zappi at Figma-exact absolute position */}
        <div className="bg-card-teal relative rounded-card p-5 mt-[6dvh] min-h-[201px] max-w-[380px] mx-auto overflow-hidden">
          {/* Mint header — token's origin mint (not the receive target) */}
          <div className="flex items-center gap-2">
            <MintIcon
              iconUrl={sourceMintIconUrl}
              imgSize="w-[24px] h-[24px]"
              className="w-[35px] h-[35px] rounded-full bg-white/20"
            />
            <div className="flex flex-col leading-tight">
              <span className="text-[17px] font-semibold text-white">
                {sourceMintName}
              </span>
              {sourceMintSubName && sourceMintSubName !== sourceMintName && (
                <span className="text-[13px] text-white/60">
                  {sourceMintSubName}
                </span>
              )}
            </div>
          </div>

          {/* Zappi — fixed px as floor, scales up when card > Figma base (380px) */}
          <img
            src={zappiLogo}
            alt=""
            className="absolute top-[65px] left-[max(25px,6.5%)] w-[max(71px,18.7%)] aspect-square pointer-events-none"
          />

          {memo ? (
            <>
              {/* Memo — right-aligned, zappi zone 회피, line-clamp-2, 길이별 축소 */}
              <p
                className="absolute left-[110px] right-[110px] top-[88px] text-center text-white line-clamp-2 break-keep font-medium"
                style={{ fontSize: `${memoFontSize}px`, lineHeight: '1.3' }}
              >
                {memo}
              </p>
              {/* Amount + fiat — right-bottom area */}
              <p className="absolute right-5 top-[136px] text-[25px] leading-[32px] font-semibold text-white">
                {formatSats(amount)}
              </p>
              {fiatLabel && (
                <p className="absolute right-5 top-[168px] text-[17px] leading-[21px] text-white/70">
                  ({fiatLabel})
                </p>
              )}
            </>
          ) : (
            <>
              {/* No memo — amount centered-ish, zappi still at fixed left */}
              <p className="absolute inset-x-0 top-[86px] text-[28px] leading-[35px] font-semibold text-white text-center">
                {formatSats(amount)}
              </p>
              {fiatLabel && (
                <p className="absolute inset-x-0 top-[125px] text-[17px] leading-[21px] text-white/70 text-center">
                  ({fiatLabel})
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <BottomActionBar gap="none" className="px-6">
        {/* Detail rows */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setMintSheetOpen(true)}
            className="w-full flex justify-between items-start py-2.5 border-b border-border/50 active:bg-foreground/[0.03] transition-colors"
          >
            <span className="text-body text-foreground-muted">{t('receive.token.receiveMint')}</span>
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1">
                <span className="text-body font-medium text-foreground">
                  {receiveMintName}
                </span>
                <ChevronRight className="w-4 h-4 text-foreground-muted" />
              </div>
              <span className="text-caption text-foreground-muted mt-0.5">
                {t('common.balance')} {formatSats(receiveMintBalance)}
              </span>
            </div>
          </button>
          {fee !== null && fee > 0 && (
            <div className="flex justify-between py-2.5 border-b border-border/50">
              <span className="text-body text-foreground-muted">{t('token.reclaim.summaryFee')}</span>
              <span className="text-body font-medium text-foreground">
                -{formatSats(fee)}
              </span>
            </div>
          )}
          <div className="flex justify-between py-2.5">
            <span className="text-body font-bold text-foreground">{t('receive.token.netAmount')}</span>
            <span className="text-body font-bold text-foreground">
              {isSwap ? '~' : '+'}{formatSats(netAmount)}
            </span>
          </div>
        </div>

        <Button
          variant="brand"
          size="xl"
          onClick={handleReceive}
          disabled={busy}
          className="w-full"
        >
          {busy
            ? t('tokenRegister.receiving')
            : isSwap
              ? t('tokenRegister.receiveToMyMint')
              : t('receive.token.receive')}
        </Button>
      </BottomActionBar>

      <MintSelectBottomSheet
        isOpen={mintSheetOpen}
        onClose={() => setMintSheetOpen(false)}
        onSelect={(url) => setReceiveMintUrl(url)}
        selectedMintUrl={receiveMintUrl}
        allowEmpty
      />
    </div>
  )
}
