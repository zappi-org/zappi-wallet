import { BottomActionBar } from '@/ui/components/common/BottomActionBar'
import { Button } from '@/ui/components/common/Button'
import { useFormatSats } from '@/utils/format'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { Copy, Eye, Share2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { MOCK_CREATE_FEE } from '../mockData'

export interface CreatedStepProps {
  amount: number
  memo: string
  senderPaysFee: boolean
  mintUrl: string
  onClose: () => void
}

export function CreatedStep({
  amount,
  memo,
  senderPaysFee,
  mintUrl,
  onClose,
}: CreatedStepProps) {
  const formatSats = useFormatSats()
  const [veiled, setVeiled] = useState(true)
  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName } = useMintMetadata(mintUrls)
  const mintName = getDisplayName(mintUrl)

  const displayedAmount = senderPaysFee ? amount + MOCK_CREATE_FEE : amount

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={onClose}
          aria-label="닫기"
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <X className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold text-foreground pointer-events-none">
          토큰이 만들어졌어요
        </h1>
        <div className="w-10" />
      </header>

      <div className="flex-1 overflow-y-auto px-6 pt-2 flex flex-col gap-6">
        {/* QR placeholder */}
        <button
          type="button"
          onClick={() => setVeiled((v) => !v)}
          className="relative aspect-square w-full max-w-[360px] mx-auto rounded-card bg-background-card overflow-hidden flex items-center justify-center"
        >
          {!veiled && (
            <>
              <div className="absolute top-4 left-4 w-10 h-10 border-t-4 border-l-4 border-foreground rounded-tl-sm" />
              <div className="absolute top-4 right-4 w-10 h-10 border-t-4 border-r-4 border-foreground rounded-tr-sm" />
              <div className="absolute bottom-4 left-4 w-10 h-10 border-b-4 border-l-4 border-foreground rounded-bl-sm" />
              <div className="absolute bottom-4 right-4 w-10 h-10 border-b-4 border-r-4 border-foreground rounded-br-sm" />
            </>
          )}

          <div
            className={`flex flex-col items-center gap-2 transition-all ${
              veiled ? 'blur-md opacity-40' : ''
            }`}
          >
            <div className="text-6xl">🔳</div>
          </div>

          {veiled && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <div className="text-5xl">🙈</div>
              <div className="flex items-center gap-1.5 text-caption text-foreground-muted">
                <Eye className="w-4 h-4" strokeWidth={1.8} />
                <span>탭해서 보기</span>
              </div>
            </div>
          )}
        </button>

        {/* Amount + meta */}
        <div className="flex flex-col items-center gap-1">
          <p className="text-heading leading-none font-semibold text-foreground">
            {formatSats(displayedAmount)}
          </p>
          <p className="text-body text-foreground-muted mt-2">
            {memo ? `${memo} · ` : ''}
            {mintName}
          </p>
          {!senderPaysFee && (
            <p className="text-caption text-foreground-muted mt-1">
              수취 수수료 {formatSats(MOCK_CREATE_FEE)}
            </p>
          )}
        </div>

        {/* Copy / Share */}
        <div className="flex items-center gap-3 mt-2">
          <Button variant="secondary" size="lg" className="flex-1" icon={<Copy className="w-4 h-4" strokeWidth={1.8} />}>
            복사
          </Button>
          <Button variant="secondary" size="lg" className="flex-1" icon={<Share2 className="w-4 h-4" strokeWidth={1.8} />}>
            공유
          </Button>
        </div>
      </div>

      <BottomActionBar extraBottom={16} gap="sm">
        <button
          type="button"
          className="w-full h-11 text-body text-foreground-muted hover:text-foreground transition-colors"
        >
          되찾기 (수취 수수료가 들어요)
        </button>
        <Button variant="brand" size="xl" onClick={onClose} className="w-full">
          확인
        </Button>
      </BottomActionBar>
    </div>
  )
}
