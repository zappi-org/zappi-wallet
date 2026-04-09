/**
 * SendTokenConfirmStep — Confirmation before creating an eCash token
 * "토큰을 만들까요?" with amount display and hint text
 */

import { useTranslation, Trans } from 'react-i18next'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useAppStore } from '@/store'
import { hapticTap } from '@/ui/utils/haptic'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { HintBox } from '@/ui/components/common/HintBox'
import { ScreenHeader } from '@/ui/components/common/ScreenHeader'

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
      <ScreenHeader title={t('send.tokenConfirm.title')} onBack={onBack} />

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
        <HintBox className="mb-3">
          <p className="whitespace-pre-line">{t('send.tokenConfirm.hint')}</p>
        </HintBox>
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
