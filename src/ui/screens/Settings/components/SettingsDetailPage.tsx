import { type ReactNode } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SettingsDetailPageProps {
  title: string
  onBack: () => void
  children: ReactNode
}

export function SettingsDetailPage({ title, onBack, children }: SettingsDetailPageProps) {
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden z-[65]">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border">
        <button onClick={onBack} aria-label={t('common.back')} className="p-1">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h2 className="text-body font-semibold tracking-tight">{title}</h2>
      </header>
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
