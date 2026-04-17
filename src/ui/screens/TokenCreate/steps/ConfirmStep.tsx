import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { Button } from '@/ui/components/common/Button'
import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { useFormatSats, formatFiatAmount } from '@/utils/format'
import { MOCK_MINT, MOCK_BALANCE, MOCK_CREATE_FEE, mockSatsToUsd } from '../mockData'

export interface ConfirmStepProps {
  amount: number
  memo: string
  senderPaysFee: boolean
  onBack: () => void
  onConfirm: () => void
}

export function ConfirmStep({
  amount,
  memo,
  senderPaysFee,
  onBack,
  onConfirm,
}: ConfirmStepProps) {
  const formatSats = useFormatSats()
  const tokenAmount = senderPaysFee ? amount + MOCK_CREATE_FEE : amount
  const postBalance = MOCK_BALANCE - tokenAmount - MOCK_CREATE_FEE
  const fiatLabel = formatFiatAmount(mockSatsToUsd(tokenAmount), 'USD')

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title="생성 확인" onBack={onBack} />

      {/* Centered flowing question */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="text-center">
          <p className="text-heading font-semibold text-foreground">
            <span className="text-brand">{MOCK_MINT.name}</span>에서{' '}
            <span className="text-brand">{formatSats(tokenAmount)}</span>
            <br />
            토큰을 만들까요?
          </p>
          <p className="text-body text-foreground-muted mt-3">~ {fiatLabel}</p>
        </div>
      </div>

      {/* Bottom panel: warning + detail rows + button */}
      <BottomActionBar extraBottom={16} gap="none" className="px-6">
        {/* Warning */}
        <div className="px-4 py-3 rounded-card bg-background-card mb-4">
          <p className="text-caption text-foreground leading-relaxed">
            ! 토큰은 받는 사람이 등록하기 전 까지 되찾을 수 있어요
          </p>
        </div>

        {/* Detail rows */}
        <div className="mb-4">
          {memo && (
            <div className="flex justify-between py-2.5 border-b border-border/50">
              <span className="text-body text-foreground-muted">메모</span>
              <span className="text-body font-medium text-foreground truncate max-w-[200px]">
                {memo}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center py-2.5 border-b border-border/50">
            <span className="text-body text-foreground-muted">민트</span>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-background-card flex items-center justify-center text-[11px]">
                {MOCK_MINT.logo}
              </div>
              <span className="text-body font-medium text-foreground">{MOCK_MINT.name}</span>
            </div>
          </div>
          <div className="flex justify-between py-2.5 border-b border-border/50">
            <span className="text-body text-foreground-muted">생성 수수료</span>
            <span className="text-body font-medium text-foreground">
              {formatSats(MOCK_CREATE_FEE)}
            </span>
          </div>
          <div className="flex justify-between py-2.5">
            <span className="text-body font-bold text-foreground">생성 후 잔액</span>
            <span className="text-body font-bold text-foreground">
              {formatSats(postBalance)}
            </span>
          </div>
        </div>

        <Button variant="brand" size="xl" onClick={onConfirm} className="w-full">
          다음
        </Button>
      </BottomActionBar>
    </div>
  )
}
