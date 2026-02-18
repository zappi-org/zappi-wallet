import { Database, Server, ShieldCheck, FileKey, RefreshCcw, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface WalletManagementSectionProps {
  mintsCount: number
  relaysCount: number
  onOpenMints: () => void
  onOpenRelays: () => void
  onOpenRestore: () => void
  onOpenBackup: () => void
}

export function WalletManagementSection({
  mintsCount,
  relaysCount,
  onOpenMints,
  onOpenRelays,
  onOpenRestore,
  onOpenBackup,
}: WalletManagementSectionProps) {
  const { t } = useTranslation()

  return (
    <section>
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-2 px-2">{t('settings.walletManagement')}</h3>
      <div className="bg-white/60 rounded-2xl overflow-hidden shadow-sm border border-white/50 divide-y divide-primary/5">
        {/* Manage Mints */}
        <button
          onClick={onOpenMints}
          className="w-full p-3 flex items-center justify-between hover:bg-white/40 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-xl text-foreground">
              <Database className="w-4 h-4" />
            </div>
            <span className="font-bold text-xs">{t('settings.manageMints')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-foreground-muted bg-background px-2 py-1 rounded-lg">{t('settings.mintCount', { count: mintsCount })}</span>
            <ChevronRight className="w-4 h-4 text-foreground-muted" />
          </div>
        </button>

        {/* Manage Relays */}
        <button
          onClick={onOpenRelays}
          className="w-full p-3 flex items-center justify-between hover:bg-white/40 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-xl text-foreground">
              <Server className="w-4 h-4" />
            </div>
            <span className="font-bold text-xs">{t('settings.manageRelays')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-foreground-muted bg-background px-2 py-1 rounded-lg">{t('settings.mintCount', { count: relaysCount })}</span>
            <ChevronRight className="w-4 h-4 text-foreground-muted" />
          </div>
        </button>

        {/* Verify Balance */}
        <button
          onClick={onOpenRestore}
          className="w-full p-3 flex items-center justify-between hover:bg-white/40 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-xl text-foreground">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-xs">{t('settings.verifyBalance')}</span>
              <span className="text-[10px] text-foreground-muted">{t('settings.findUnusedTokens')}</span>
            </div>
          </div>
          <div className="bg-primary/10 p-2 rounded-full">
            <RefreshCcw className="w-3.5 h-3.5 text-foreground" />
          </div>
        </button>

        {/* Mnemonic Backup */}
        <button
          onClick={onOpenBackup}
          className="w-full p-3 flex items-center justify-between hover:bg-white/40 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-xl text-foreground">
              <FileKey className="w-4 h-4" />
            </div>
            <span className="font-bold text-xs">{t('settings.mnemonicBackup')}</span>
          </div>
          <ChevronRight className="w-4 h-4 text-foreground-muted" />
        </button>
      </div>
    </section>
  )
}
