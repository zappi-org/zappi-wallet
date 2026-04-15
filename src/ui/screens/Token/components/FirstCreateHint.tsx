import { useTranslation } from 'react-i18next'

export interface FirstCreateHintProps {
  onDismiss: () => void
}

export function FirstCreateHint({ onDismiss }: FirstCreateHintProps) {
  const { t } = useTranslation()

  return (
    <div className="relative rounded-lg bg-foreground/[0.03] border border-border px-4 py-3 pr-20">
      <p className="text-caption text-foreground whitespace-pre-line leading-relaxed">
        {t('token.firstCreate.hint')}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-3 bottom-2 text-overline text-foreground-muted hover:text-foreground transition-colors"
      >
        {t('token.firstCreate.dismiss')}
      </button>
    </div>
  )
}
