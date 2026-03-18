import { ChevronRight, Wallet } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface WalletManagementSectionProps {
  mintsCount: number
  relaysCount: number
  onOpenMints: () => void
  onOpenRelays: () => void
  onOpenRestore: () => void
  onOpenBackup: () => void
  onTransfer?: () => void
}

export function WalletManagementSection({
  mintsCount,
  relaysCount,
  onOpenMints,
  onOpenRelays,
  onOpenRestore,
  onOpenBackup,
  onTransfer,
}: WalletManagementSectionProps) {
  const { t } = useTranslation()

  return (
    <section>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-muted px-4 pt-6 pb-2 flex items-center gap-1.5">
        <Wallet className="w-3.5 h-3.5" />
        {t('settings.walletManagement')}
      </p>
      <div className="bg-background-card">
        <button
          onClick={onOpenMints}
          className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
        >
          <span className="text-[14px] font-medium">{t('settings.manageMints')}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] text-foreground-muted">{mintsCount}</span>
            <ChevronRight className="w-4 h-4 text-foreground-subtle" />
          </div>
        </button>

        <button
          onClick={onOpenRelays}
          className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
        >
          <span className="text-[14px] font-medium">{t('settings.manageRelays')}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] text-foreground-muted">{relaysCount}</span>
            <ChevronRight className="w-4 h-4 text-foreground-subtle" />
          </div>
        </button>

        <button
          onClick={onTransfer}
          className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
        >
          <span className="text-[14px] font-medium">{t('actions.transfer')}</span>
          <ChevronRight className="w-4 h-4 text-foreground-subtle" />
        </button>

        <button
          onClick={onOpenRestore}
          className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
        >
          <span className="text-[14px] font-medium">{t('settings.verifyBalance')}</span>
          <ChevronRight className="w-4 h-4 text-foreground-subtle" />
        </button>

        <button
          onClick={onOpenBackup}
          className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
        >
          <span className="text-[14px] font-medium">{t('settings.mnemonicBackup')}</span>
          <ChevronRight className="w-4 h-4 text-foreground-subtle" />
        </button>
      </div>
    </section>
  )
}
