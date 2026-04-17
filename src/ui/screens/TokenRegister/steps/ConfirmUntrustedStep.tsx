import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { formatFiatAmount, useFormatSats } from '@/utils/format'
import { AlertTriangle, ArrowRightLeft, Plus } from 'lucide-react'
import {
  MOCK_REGISTER_BALANCE,
  MOCK_REGISTER_FEE,
  MOCK_UNTRUSTED_MINT,
  mockSatsToUsd,
} from '../mockData'

export interface ConfirmUntrustedStepProps {
  amount: number
  onBack: () => void
  onAddAndReceive: () => void
  onSwapToMyMint: () => void
}

export function ConfirmUntrustedStep({
  amount,
  onBack,
  onAddAndReceive,
  onSwapToMyMint,
}: ConfirmUntrustedStepProps) {
  const formatSats = useFormatSats()
  const fiatLabel = formatFiatAmount(mockSatsToUsd(amount), 'USD')
  const netAmount = amount - MOCK_REGISTER_FEE

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title="토큰 확인" onBack={onBack} />

      {/* Content — centered warning */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 space-y-4">
        <AlertTriangle className="w-12 h-12 text-accent-warning" strokeWidth={1.8} />

        <p className="text-heading font-semibold text-foreground text-center whitespace-pre-line">
          {formatSats(amount)}를 받으려면{'\n'}확인이 필요해요.
        </p>
        <p className="text-body text-foreground-muted">~ {fiatLabel}</p>

        {/* Origin card */}
        <div className="flex items-center gap-2.5 bg-white border border-border/50 rounded-card px-4 py-3 max-w-[280px] shadow-sm">
          <div className="w-9 h-9 rounded-[10px] bg-accent-warning/10 flex items-center justify-center text-base">
            {MOCK_UNTRUSTED_MINT.logo}
          </div>
          <p className="text-caption text-foreground-muted leading-snug">
            <span className="font-semibold text-foreground">
              {MOCK_UNTRUSTED_MINT.name}
            </span>
            {' · '}
            <span className="text-accent-warning font-medium">미등록 민트</span>
          </p>
        </div>

        <p className="text-caption text-foreground-muted text-center leading-relaxed max-w-[280px]">
          모르는 민트라면 추가하지 않고
          <br />내 민트로 받을 수도 있어요.
        </p>
      </div>

      {/* Fee preview rows */}
      <div className="px-6 mb-3 shrink-0">
        <div className="flex justify-between py-2 border-b border-border/50">
          <span className="text-body text-foreground-muted">잔액</span>
          <span className="text-body text-foreground">
            {formatSats(MOCK_REGISTER_BALANCE)}
          </span>
        </div>
        <div className="flex justify-between py-2 border-b border-border/50">
          <span className="text-body text-foreground-muted">수취 수수료</span>
          <span className="text-body font-medium text-foreground">
            -{formatSats(MOCK_REGISTER_FEE)}
          </span>
        </div>
        <div className="flex justify-between py-2">
          <span className="text-body font-bold text-foreground">실제 수령액</span>
          <span className="text-body font-bold text-foreground">
            +{formatSats(netAmount)}
          </span>
        </div>
      </div>

      {/* Vertical choice cards */}
      <div className="px-5 pb-6 pb-safe shrink-0 space-y-2.5">
        <button
          onClick={onAddAndReceive}
          className="w-full bg-brand rounded-card px-5 py-[18px] flex items-center gap-3.5 active:scale-[0.98] transition-transform shadow-lg shadow-brand/25"
        >
          <div className="w-10 h-10 rounded-[10px] bg-white/20 flex items-center justify-center shrink-0">
            <Plus className="w-5 h-5 text-white" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-body font-bold text-white truncate">
              이 민트를 추가하고 받기
            </p>
            <p className="text-caption text-white/70 mt-0.5">
              다음부터는 이 민트를 신뢰합니다
            </p>
          </div>
        </button>

        <button
          onClick={onSwapToMyMint}
          className="w-full bg-muted rounded-card px-5 py-[18px] flex items-center gap-3.5 active:scale-[0.98] transition-transform"
        >
          <div className="w-10 h-10 rounded-[10px] bg-foreground/[0.06] flex items-center justify-center shrink-0">
            <ArrowRightLeft className="w-5 h-5 text-foreground" strokeWidth={1.8} />
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-body font-bold text-foreground truncate">
              내 민트로 받기
            </p>
            <p className="text-caption text-foreground-muted mt-0.5">
              스왑 수수료가 들 수 있어요
            </p>
          </div>
        </button>
      </div>
    </div>
  )
}
