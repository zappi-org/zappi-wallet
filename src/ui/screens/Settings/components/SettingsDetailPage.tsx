import { type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SettingsDetailPageProps {
  title: string
  onBack: () => void
  children: ReactNode
  noScroll?: boolean
}

export function SettingsDetailPage({ title, onBack, children, noScroll }: SettingsDetailPageProps) {
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden z-[65]">
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h2 className="absolute inset-0 flex items-center justify-center px-16 text-center text-heading font-bold text-foreground pointer-events-none truncate">{title}</h2>
        <div className="w-10" />
      </header>
      <div className={noScroll ? "flex-1 flex flex-col overflow-hidden" : "flex-1 overflow-y-auto"}>
        {children}
      </div>
    </div>
  )
}
