import { Check, Copy, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface ProfileSectionProps {
  nostrPubkey: string | null
  npubCopied: boolean
  encodeNpub: (pubkey: string) => string
  onCopyNpub: () => void
}

export function ProfileSection({
  nostrPubkey,
  npubCopied,
  encodeNpub,
  onCopyNpub,
}: ProfileSectionProps) {
  const { t } = useTranslation()

  return (
    <section>
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-2 px-2">{t('settings.profile')}</h3>
      <div className="bg-white/60 rounded-2xl p-3 shadow-sm border border-white/50 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent-primary flex items-center justify-center text-primary-foreground font-bold text-base">
            <User className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-foreground">{t('settings.zappiUser')}</h4>
          </div>
        </div>
        {nostrPubkey && (
          <div className="pt-2 border-t border-primary/5">
            <label className="text-[10px] font-bold text-foreground-muted ml-2 block mb-1">npub</label>
            <button
              onClick={onCopyNpub}
              className="w-full bg-background/50 p-2 rounded-xl flex items-center justify-between gap-2 transition-all hover:bg-background active:scale-[0.99]"
            >
              <span className="text-[10px] text-foreground-muted font-mono truncate">{encodeNpub(nostrPubkey)}</span>
              {npubCopied ? (
                <div className="animate-fadeIn">
                  <Check className="w-3.5 h-3.5 text-accent-primary" />
                </div>
              ) : (
                <div>
                  <Copy className="w-3.5 h-3.5" />
                </div>
              )}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
