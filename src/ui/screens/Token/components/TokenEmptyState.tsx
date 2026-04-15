import { useTranslation } from 'react-i18next'
import { HintBox } from '@/ui/components/common/HintBox'

export function TokenEmptyState() {
  const { t } = useTranslation()

  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-4 gap-10">
      <p className="text-title text-foreground whitespace-pre-line leading-relaxed">
        {t('token.empty.title')}
      </p>
      <HintBox className="w-full">
        {t('token.empty.footerNote')}
      </HintBox>
    </div>
  )
}
