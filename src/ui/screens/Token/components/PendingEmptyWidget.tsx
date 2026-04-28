import { Check } from 'lucide-react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

export interface PendingEmptyWidgetProps {
  onDismiss: () => void
}

export function PendingEmptyWidget({ onDismiss }: PendingEmptyWidgetProps) {
  const { t } = useTranslation()

  return (
    <motion.div
      initial={{ opacity: 0, x: 64 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 64 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="relative flex items-center gap-3 rounded-[20px] bg-card border border-border px-4 py-4"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-900">
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
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-5 bottom-5 text-overline text-foreground-muted hover:text-foreground transition-colors"
      >
        {t('common.close')}
      </button>
    </motion.div>
  )
}
