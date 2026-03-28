/**
 * SendTokenConfirmStep — Confirmation before creating an eCash token
 * "토큰을 만들까요?" with amount display and hint text
 */

import { ArrowLeft } from 'lucide-react'
import { useTranslation, Trans } from 'react-i18next'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { hapticTap } from '@/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'

interface SendTokenConfirmStepProps {
  onBack: () => void
  onConfirm: () => void
  amount: number
  mintUrl: string
  memo: string
  isLoading?: boolean
}

export function SendTokenConfirmStep({
  onBack,
  onConfirm,
  amount,
  mintUrl,
  memo,
  isLoading = false,
}: SendTokenConfirmStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName } = useMintMetadata(settings.mints)

  const mintName = getDisplayName(mintUrl)

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
        <h1 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">
          {t('send.tokenConfirm.title')}
        </h1>
        <div className="w-10" />
      </header>

      {/* Centered content — same pattern as SendConfirmStep */}
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <div className="text-center">
          <p className="text-heading font-semibold whitespace-pre-line">
            <Trans
              i18nKey="send.tokenConfirm.fullQuestion"
              values={{ mint: mintName, amount: formatSats(amount) }}
              components={{ b: <span className="text-brand" /> }}
            />
          </p>
        </div>

        {formatFiat(amount) && (
          <p className="text-body text-foreground-muted mt-3">{formatFiat(amount)}</p>
        )}

        {/* Memo */}
        {memo && (
          <p className="text-body text-foreground-muted mt-2">
            {t('send.confirm.memo')}: {memo}
          </p>
        )}
      </div>

      {/* Bottom — hint + button */}
      <div className="px-6 pb-6 pb-safe shrink-0">
        <div className="flex items-start gap-2.5 bg-foreground/[0.04] rounded-xl px-4 py-3 mb-3">
          <span className="text-caption leading-relaxed mt-px">💡</span>
          <p className="text-caption text-foreground-muted leading-relaxed whitespace-pre-line">
            {t('send.tokenConfirm.hint')}
          </p>
        </div>
        <Button
          variant="brand"
          size="xl"
          onClick={() => {
            hapticTap()
            onConfirm()
          }}
          loading={isLoading}
          className="w-full"
        >
          {t('send.tokenConfirm.create')}
        </Button>
      </div>
    </div>
  )
}
