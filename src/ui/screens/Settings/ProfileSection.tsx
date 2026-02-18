import { Check, Copy, Save, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/components/ui/utils'

export interface ProfileSectionProps {
  nostrPubkey: string | null
  npubCopied: boolean
  lightningAddress: string
  lightningError: string
  isValidatingLightning: boolean
  savedLightningAddress: string | undefined
  encodeNpub: (pubkey: string) => string
  onCopyNpub: () => void
  onLightningAddressChange: (value: string) => void
  onLightningAddressSave: () => void
  onLightningErrorClear: () => void
}

export function ProfileSection({
  nostrPubkey,
  npubCopied,
  lightningAddress,
  lightningError,
  isValidatingLightning,
  savedLightningAddress,
  encodeNpub,
  onCopyNpub,
  onLightningAddressChange,
  onLightningAddressSave,
  onLightningErrorClear,
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
        {/* Lightning Address */}
        <div className="pt-2 border-t border-primary/5">
          <label className="text-[10px] font-bold text-foreground-muted ml-2 block mb-1">{t('settings.lightningAddress')}</label>
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <input
                type="text"
                value={lightningAddress}
                onChange={(e) => { onLightningAddressChange(e.target.value); onLightningErrorClear() }}
                placeholder="user@getalby.com"
                disabled={isValidatingLightning}
                className="w-full bg-background/50 p-2 pr-7 rounded-xl outline-none text-[10px] text-foreground placeholder:text-foreground-muted/50 font-medium"
              />
              {lightningAddress === savedLightningAddress && savedLightningAddress && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                  <Check className="w-3 h-3 text-accent-primary" />
                </div>
              )}
            </div>
            <button
              onClick={onLightningAddressSave}
              disabled={isValidatingLightning || !lightningAddress.trim() || lightningAddress === savedLightningAddress}
              className={cn(
                'p-1.5 rounded-lg transition-all',
                isValidatingLightning
                  ? 'bg-primary/10'
                  : !lightningAddress.trim() || lightningAddress === savedLightningAddress
                  ? 'bg-primary/5 text-foreground-muted/30'
                  : 'bg-primary text-white hover:bg-card-green-darker'
              )}
            >
              {isValidatingLightning ? (
                <div className="w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          {lightningError && (
            <p className="text-[10px] text-accent-danger font-bold mt-1 ml-2">{lightningError}</p>
          )}
        </div>
      </div>
    </section>
  )
}
