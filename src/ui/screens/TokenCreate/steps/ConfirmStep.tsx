import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { Button } from '@/ui/components/common/Button'
import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { useFormatFiat, useFormatSats } from '@/utils/format'
import { useWallet } from '@/ui/hooks/use-wallet'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useMemo } from 'react'
import { MOCK_CREATE_FEE } from '../mockData'

export interface ConfirmStepProps {
  amount: number
  memo: string
  senderPaysFee: boolean
  mintUrl: string
  onBack: () => void
  onConfirm: () => void
}

export function ConfirmStep({
  amount,
  memo,
  senderPaysFee,
  mintUrl,
  onBack,
  onConfirm,
}: ConfirmStepProps) {
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const { balance } = useWallet()
  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)

  const mintBalance = balance.byMint[mintUrl] ?? 0
  const mintName = getDisplayName(mintUrl)
  const mintIconUrl = getIconUrl(mintUrl)

  const tokenAmount = senderPaysFee ? amount + MOCK_CREATE_FEE : amount
  const postBalance = mintBalance - tokenAmount - MOCK_CREATE_FEE
  const fiatLabel = formatFiat(tokenAmount)

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title="생성 확인" onBack={onBack} />

      {/* Centered flowing question */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="text-center">
          <p className="text-heading font-semibold text-foreground">
            <span className="text-brand">{mintName}</span>에서{' '}
            <span className="text-brand">{formatSats(tokenAmount)}</span>
            <br />
            토큰을 만들까요?
          </p>
          {fiatLabel && <p className="text-body text-foreground-muted mt-3">~ {fiatLabel}</p>}
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
              <MintIcon iconUrl={mintIconUrl} imgSize="w-5 h-5" className="w-5 h-5" />
              <span className="text-body font-medium text-foreground">{mintName}</span>
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
