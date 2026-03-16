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
            <div className="flex-1 min-w-0">
              <span className="text-[12px] font-semibold text-foreground-muted block mb-0.5">npub</span>
              <span className="text-[13px] text-foreground font-mono truncate block">
                {encodeNpub(nostrPubkey)}
              </span>
            </div>
            {npubCopied ? (
              <Check className="w-4 h-4 text-accent-primary shrink-0 ml-3" />
            ) : (
              <Copy className="w-4 h-4 text-foreground-subtle shrink-0 ml-3" />
            )}
          </button>
        )}

        {/* Lightning Address */}
        {lightningAddress ? (
          <button
            onClick={onOpenUsernameChange}
            className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
          >
            <div className="flex-1 min-w-0">
              <span className="text-[12px] font-semibold text-foreground-muted block mb-0.5">
                {t('settings.lightningAddress')}
              </span>
              <span className="text-[14px] font-medium truncate block">{lightningAddress}</span>
            </div>
            <ChevronRight className="w-4 h-4 text-foreground-subtle shrink-0" />
          </button>
        ) : (
          <div className="px-4 py-3.5">
            <span className="text-[12px] font-semibold text-foreground-muted block mb-2">
              {t('settings.lightningAddress')}
            </span>
            <button
              onClick={onRegisterLightningAddress}
              disabled={isRegistering}
              className={cn(
                'w-full py-2.5 font-semibold text-[14px] flex items-center justify-center gap-2 rounded-sm transition-colors',
                isRegistering
                  ? 'bg-foreground/[0.04] text-foreground-muted cursor-wait'
                  : 'bg-primary text-white active:opacity-80'
              )}
            >
              {isRegistering ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
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
