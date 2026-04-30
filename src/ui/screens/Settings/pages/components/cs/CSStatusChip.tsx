import { useTranslation } from 'react-i18next'
import { cn } from '@/ui/primitives/utils'
import type { CSStatusKind } from './cs-status'

interface CSStatusChipProps {
  kind: CSStatusKind
  className?: string
}

const KIND_CLASS: Record<CSStatusKind, { wrap: string; dot: string }> = {
  received: {
    wrap: 'bg-[#F0F2F7] text-foreground-muted',
    dot: 'bg-foreground-subtle',
  },
  progress: {
    wrap: 'bg-brand-50 text-brand',
    dot: 'bg-brand',
  },
  answered: {
    wrap: 'bg-background text-foreground-subtle',
    dot: 'bg-[#B3B9C9]',
  },
}

export function CSStatusChip({ kind, className }: CSStatusChipProps) {
  const { t } = useTranslation()
  const styles = KIND_CLASS[kind]

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none tracking-[-0.005em]',
        styles.wrap,
        className,
      )}
    >
      <span className={cn('inline-block w-1.5 h-1.5 rounded-full', styles.dot)} />
      {t(`support.csStatus.${kind}`)}
    </span>
  )
}
