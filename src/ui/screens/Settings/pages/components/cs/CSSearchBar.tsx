import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function CSSearchBar({ disabled = true }: { disabled?: boolean }) {
  const { t } = useTranslation()

  return (
    <div
      aria-disabled={disabled}
      className="flex items-center gap-2.5 bg-background-card border border-border rounded-[14px] px-3.5 py-3"
    >
      <Search className="w-4.5 h-4.5 text-foreground-muted" strokeWidth={1.7} />
      <span className="flex-1 text-[14px] text-foreground-subtle tracking-[-0.005em]">
        {t('support.searchPlaceholder')}
      </span>
    </div>
  )
}
