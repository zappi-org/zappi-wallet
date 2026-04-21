import { Button } from '@/ui/components/common/Button'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'
import { MintIcon } from '@/ui/components/common/MintIcon'
import { useFormatFiat, useFormatSats, useSatUnit } from '@/utils/format'
import { useWallet } from '@/ui/hooks/use-wallet'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { ArrowLeft, ChevronsUpDown } from 'lucide-react'
import { useMemo, useState } from 'react'

export interface AmountStepProps {
  onBack: () => void
  onNext: (data: { amount: number; memo: string; senderPaysFee: boolean }) => void
  mintUrl: string
  initialAmount: number
  initialMemo: string
  initialSenderPaysFee: boolean
}

const KEYS: Array<string> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'del']

export function AmountStep({
  onBack,
  onNext,
  mintUrl,
  initialAmount,
  initialMemo,
  initialSenderPaysFee,
}: AmountStepProps) {
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const unit = useSatUnit()
  const { balance } = useWallet()
  const mintUrls = useMemo(() => [mintUrl], [mintUrl])
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)

  const [amount, setAmount] = useState(initialAmount > 0 ? String(initialAmount) : '')
  const [memo, setMemo] = useState(initialMemo)
  const [senderPaysFee, setSenderPaysFee] = useState(initialSenderPaysFee)

  const mintBalance = balance.byMint[mintUrl] ?? 0
  const mintName = getDisplayName(mintUrl)
  const mintIconUrl = getIconUrl(mintUrl)

  const numericAmount = parseInt(amount, 10) || 0
  const canProceed = numericAmount > 0 && numericAmount <= mintBalance
  const displayAmount = numericAmount > 0 ? formatSats(numericAmount) : `${unit}0`
  const fiatLabel = numericAmount > 0 ? formatFiat(numericAmount) : null

  const handleKey = (key: string) => {
    if (key === 'del') {
      setAmount((prev) => prev.slice(0, -1))
      return
    }
    setAmount((prev) => {
      const next = (prev + key).replace(/^0+(?=\d)/, '')
      if (next.length > 12) return prev
      return next
    })
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <ScreenHeader title="토큰 생성하기" onBack={onBack} />

      <div className="flex-1 overflow-y-auto px-6 pt-18 flex flex-col">
        <h2 className="text-heading font-semibold text-foreground text-center">
          얼마의 토큰을 만들까요?
        </h2>

        {/* Amount hero */}
        <div className="flex flex-col items-center gap-2 mt-10">
          <p className="text-[44px] leading-none font-semibold text-foreground">
            {displayAmount}
          </p>
          <button
            type="button"
            aria-label="단위 변경"
            className="flex items-center justify-center w-8 h-8 rounded-full bg-background-card text-foreground-muted hover:text-foreground hover:bg-background-hover transition-colors"
          >
            <ChevronsUpDown className="w-4 h-4" strokeWidth={1.8} />
          </button>
          {fiatLabel && <p className="text-body text-foreground-muted">~ {fiatLabel}</p>}
        </div>

        {/* Mint bar — underline style */}
        <div className="flex items-center gap-3 mt-8 pb-2 border-b border-border w-[85%] mx-auto">
          <MintIcon iconUrl={mintIconUrl} imgSize="w-7 h-7" className="w-7 h-7" />
          <span className="text-body font-medium text-foreground flex-1">
            {mintName}
          </span>
          <span className="text-caption text-foreground-muted">잔액</span>
          <span className="text-body text-foreground">{formatSats(mintBalance)}</span>
        </div>

        {/* Memo — underline style (match receive flow) */}
        <div className="mt-4 w-[85%] mx-auto">
          <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="메모(선택사항)"
              maxLength={100}
              className="flex-1 min-w-0 bg-transparent py-2 text-body font-medium text-foreground placeholder:text-foreground-muted focus:outline-none"
            />
          </div>
        </div>

        {/* Fee toggle — hidden for now; state (senderPaysFee) stays wired at default `false`. */}
        <label className="hidden items-start w-[85%] mx-auto gap-2 mt-auto mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={senderPaysFee}
            onChange={(e) => setSenderPaysFee(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-brand shrink-0"
          />
          <span className="text-caption text-foreground-muted leading-snug">
            받는사람이 금액을 그대로 받을 수 있게 수취 수수료를 토큰에 추가해요 (선택사항)
          </span>
        </label>
      </div>

      {/* Next button with brand rounding */}
      <div className="px-6 pb-4 shrink-0">
        <Button
          variant="brand"
          size="xl"
          disabled={!canProceed}
          onClick={() =>
            onNext({ amount: numericAmount, memo, senderPaysFee })
          }
          className="w-full"
        >
          다음
        </Button>
      </div>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-0 pb-safe shrink-0">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => handleKey(key)}
            className="h-14 text-title font-normal text-foreground hover:bg-background-hover active:bg-background-card transition-colors flex items-center justify-center"
          >
            {key === 'del' ? <ArrowLeft className="w-5 h-5" strokeWidth={1.8} /> : key}
          </button>
        ))}
      </div>
    </div>
  )
}
