import { Lock, Key, Smartphone, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@/ui/components/common/Switch'

export interface SecuritySectionProps {
  autoLockEnabled: boolean
  autoLockTimeout: string
  passkeySupported: boolean
  passkeyEnabled: boolean
  onAutoLockToggle: (enabled: boolean) => void
  onAutoLockTimeoutChange: (value: string) => void
  onPasskeyToggle: (enabled: boolean) => void
  onOpenPinChange: () => void
}

export function SecuritySection({
  autoLockEnabled,
  autoLockTimeout,
  passkeySupported,
  passkeyEnabled,
  onAutoLockToggle,
  onAutoLockTimeoutChange,
  onPasskeyToggle,
  onOpenPinChange,
}: SecuritySectionProps) {
  const { t } = useTranslation()

  return (
    <section>
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-2 px-2">{t('settings.security')}</h3>
      <div className="bg-white/60 rounded-2xl overflow-hidden shadow-sm border border-white/50 divide-y divide-primary/5">
        {/* Auto Lock */}
        <div className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-xl text-foreground">
                <Lock className="w-4 h-4" />
              </div>
              <span className="font-bold text-xs">{t('settings.autoLock')}</span>
            </div>
            <div className="flex items-center gap-2">
              {autoLockEnabled && (
                <div className="flex items-center gap-1 bg-background px-2 py-1 rounded-lg">
                  <input
                    type="number"
                    value={autoLockTimeout}
                    onChange={(e) => onAutoLockTimeoutChange(e.target.value)}
                    min={1}
                    max={60}
                    className="w-8 bg-transparent text-center font-bold text-xs outline-none"
                  />
                  <span className="text-[10px] text-foreground-muted">{t('common.min')}</span>
                </div>
              )}
              <Switch checked={autoLockEnabled} onChange={onAutoLockToggle} />
            </div>
          </div>
        </div>

        {/* Biometrics */}
        {passkeySupported && (
          <div className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 bg-primary/10 rounded-xl text-foreground">
                <Smartphone className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-xs">{t('settings.faceIdTouchId')}</span>
                <span className="text-[10px] text-foreground-muted">{t('settings.biometric')}</span>
              </div>
            </div>
            <Switch checked={passkeyEnabled} onChange={onPasskeyToggle} />
          </div>
        )}

        {/* Change PIN */}
        <button
          onClick={onOpenPinChange}
          className="w-full p-3 flex items-center justify-between hover:bg-white/40 transition-colors text-left"
        >
          <div className="flex items-center gap-2">
            <div className="p-2 bg-primary/10 rounded-xl text-foreground">
              <Key className="w-4 h-4" />
            </div>
            <span className="font-bold text-xs">{t('settings.changePin')}</span>
          </div>
          <ChevronRight className="w-4 h-4 text-foreground-muted" />
        </button>
      </div>
    </section>
  )
}
