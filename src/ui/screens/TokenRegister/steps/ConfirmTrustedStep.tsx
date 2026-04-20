import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import type { MintCardVariant } from '@/ui/components/wallet/MintCard'
import { formatFiatAmount, useFormatSats } from '@/utils/format'
import { ChevronRight } from 'lucide-react'
import zappiLogo from '@/assets/zappi.png'
import {
  MOCK_REGISTER_BALANCE,
  MOCK_REGISTER_FEE,
  MOCK_TRUSTED_MINT,
  mockSatsToUsd,
} from '../mockData'

export interface ConfirmTrustedStepProps {
  amount: number
  memo?: string
  onBack: () => void
  onReceive: () => void
}

const VARIANT_CLASS: Record<MintCardVariant, string> = {
  indigo: 'bg-card-indigo',
  coral: 'bg-card-coral',
  teal: 'bg-card-teal',
  slate: 'bg-card-slate',
  amber: 'bg-card-amber',
  plum: 'bg-card-plum',
  forest: 'bg-card-forest',
  light: 'bg-card-gradient-light',
  medium: 'bg-card-gradient-medium',
  dark: 'bg-card-gradient-dark',
  darker: 'bg-card-gradient-darker',
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
  amount,
  memo,
  onBack,
  onReceive,
}: ConfirmTrustedStepProps) {
  const formatSats = useFormatSats()
  const netAmount = amount - MOCK_REGISTER_FEE
  const fiatLabel = formatFiatAmount(mockSatsToUsd(amount), 'USD')
  const cardBg = VARIANT_CLASS[MOCK_TRUSTED_MINT.variant]
  const memoFontSize = memo ? memoFontSizeFor(memo) : 21

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title="토큰 확인" onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-4 pt-2">
        <h2 className="text-heading font-semibold text-foreground text-center">
          토큰이 도착했어요!
        </h2>

        {/* Hero card — fixed min-height, zappi at Figma-exact absolute position */}
        <div
          className={`${cardBg} relative rounded-card p-5 mt-5 min-h-[201px] max-w-[380px] mx-auto overflow-hidden`}
        >
          {/* Mint header — natural top-left flow */}
          <div className="flex items-center gap-2">
            <div className="w-[35px] h-[35px] rounded-full bg-white/20 flex items-center justify-center text-base shrink-0">
              {MOCK_TRUSTED_MINT.logo}
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[17px] font-semibold text-white">
                {MOCK_TRUSTED_MINT.name}
              </span>
              {MOCK_TRUSTED_MINT.subName && (
                <span className="text-[13px] text-white/60">
                  {MOCK_TRUSTED_MINT.subName}
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
              <p className="absolute right-5 top-[168px] text-[17px] leading-[21px] text-white/70">
                ({fiatLabel})
              </p>
            </>
          ) : (
            <>
              {/* No memo — amount centered-ish, zappi still at fixed left */}
              <p className="absolute inset-x-0 top-[86px] text-[28px] leading-[35px] font-semibold text-white text-center">
                {formatSats(amount)}
              </p>
              <p className="absolute inset-x-0 top-[125px] text-[17px] leading-[21px] text-white/70 text-center">
                ({fiatLabel})
              </p>
            </>
          )}
        </div>
      </div>

      <BottomActionBar extraBottom={16} gap="none" className="px-6">
        {/* Detail rows */}
        <div className="mb-4">
          <div className="flex justify-between items-start py-2.5 border-b border-border/50">
            <span className="text-body text-foreground-muted">받을 민트</span>
            <div className="flex flex-col items-end">
              <div className="flex items-center gap-1">
                <span className="text-body font-medium text-foreground">
                  {MOCK_TRUSTED_MINT.name}
                </span>
                <ChevronRight className="w-4 h-4 text-foreground-muted" />
              </div>
              <span className="text-caption text-foreground-muted mt-0.5">
                잔액 {formatSats(MOCK_REGISTER_BALANCE)}
              </span>
            </div>
          </div>
          <div className="flex justify-between py-2.5 border-b border-border/50">
            <span className="text-body text-foreground-muted">수취 수수료</span>
            <span className="text-body font-medium text-foreground">
              -{formatSats(MOCK_REGISTER_FEE)}
            </span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-body font-bold text-foreground">실제 수령액</span>
            <span className="text-body font-bold text-foreground">
              +{formatSats(netAmount)}
            </span>
          </div>
        </div>

        <Button variant="brand" size="xl" onClick={onReceive} className="w-full">
          받기
        </Button>
      </BottomActionBar>
    </div>
  )
}
