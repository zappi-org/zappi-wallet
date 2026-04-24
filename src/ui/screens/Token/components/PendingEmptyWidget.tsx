import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'

export function PendingEmptyWidget() {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-3 rounded-card bg-card border border-border px-4 py-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand">
        <Check className="size-5 text-white" strokeWidth={3} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-body font-bold text-foreground">
          {t('token.pendingEmpty.title')}
        </span>
        <span className="text-caption text-foreground-muted">
          {t('token.pendingEmpty.subtitle')}
        </span>
      </div>
    </div>
  )
}
