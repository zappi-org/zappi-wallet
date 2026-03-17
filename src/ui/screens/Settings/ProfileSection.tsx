import { Check, Copy, ChevronRight, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/components/ui/utils'

export interface ProfileSectionProps {
  nostrPubkey: string | null
  npubCopied: boolean
  encodeNpub: (pubkey: string) => string
  onCopyNpub: () => void
  lightningAddress: string | undefined
  isRegistering: boolean
  onRegisterLightningAddress: () => void
  onOpenUsernameChange?: () => void
  onAnalytics?: () => void
}

export function ProfileSection({
  nostrPubkey,
  npubCopied,
  encodeNpub,
  onCopyNpub,
  lightningAddress,
  isRegistering,
  onRegisterLightningAddress,
  onOpenUsernameChange,
  onAnalytics,
}: ProfileSectionProps) {
  const { t } = useTranslation()

  return (
    <section>
      <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-muted px-4 pt-4 pb-2 flex items-center gap-1.5">
        <User className="w-3.5 h-3.5" />
        {t('settings.profile')}
      </p>
      <div className="bg-background-card">
        {/* npub */}
        {nostrPubkey && (
          <button
            onClick={onCopyNpub}
            className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
          >
            <span className="text-[14px] font-medium">npub</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] text-foreground-muted font-mono truncate max-w-[180px]">
                {encodeNpub(nostrPubkey)}
              </span>
              {npubCopied ? (
                <Check className="w-4 h-4 text-accent-primary shrink-0" />
              ) : (
                <Copy className="w-4 h-4 text-foreground-subtle shrink-0" />
              )}
            </div>
          </button>
        )}

        {/* Lightning Address */}
        {lightningAddress ? (
          <button
            onClick={onOpenUsernameChange}
            className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
          >
            <span className="text-[14px] font-medium">{t('settings.lightningAddress')}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[14px] text-foreground-muted">{lightningAddress}</span>
              <ChevronRight className="w-4 h-4 text-foreground-subtle shrink-0" />
            </div>
          </button>
        ) : (
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-[14px] font-medium">{t('settings.lightningAddress')}</span>
            <button
              onClick={onRegisterLightningAddress}
              disabled={isRegistering}
              className={cn(
                'py-1.5 px-3 font-semibold text-[13px] flex items-center gap-1.5 rounded-sm transition-colors',
                isRegistering
                  ? 'text-foreground-muted cursor-wait'
                  : 'border border-[#3b7df5] text-[#3b7df5] active:opacity-80'
              )}
            >
              {isRegistering ? (
                <>
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  {t('settings.registeringLightningAddress')}
                </>
              ) : (
                t('settings.registerLightningAddress')
              )}
            </button>
          </div>
        )}

        {/* Analytics */}
        <button
          onClick={onAnalytics}
          className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
        >
          <span className="text-[14px] font-medium">{t('actions.analytics')}</span>
          <ChevronRight className="w-4 h-4 text-foreground-subtle" />
        </button>
      </div>
    </section>
  )
}
