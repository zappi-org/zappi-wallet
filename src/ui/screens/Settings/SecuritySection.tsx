import { ChevronRight, Shield } from 'lucide-react'
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
      <p className="text-[12px] font-semibold uppercase tracking-wide text-foreground-muted px-4 pt-6 pb-2 flex items-center gap-1.5">
        <Shield className="w-3.5 h-3.5" />
        {t('settings.security')}
      </p>
      <div className="bg-background-card">
        {/* Auto Lock */}
        <div className="px-4 py-3.5 flex items-center justify-between">
          <span className="text-[14px] font-medium">{t('settings.autoLock')}</span>
          <div className="flex items-center gap-2">
            {autoLockEnabled && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={autoLockTimeout}
                  onChange={(e) => onAutoLockTimeoutChange(e.target.value)}
                  min={1}
                  max={60}
                  className="w-8 bg-transparent text-center font-semibold text-[14px] outline-none"
                />
                <span className="text-[12px] text-foreground-muted">{t('common.min')}</span>
              </div>
            )}
            <Switch checked={autoLockEnabled} onChange={onAutoLockToggle} />
          </div>
        </div>

        {/* Biometrics */}
        {passkeySupported && (
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-[14px] font-medium">{t('settings.faceIdTouchId')}</span>
            <Switch checked={passkeyEnabled} onChange={onPasskeyToggle} />
          </div>
        )}

        {/* Change PIN */}
        <button
          onClick={onOpenPinChange}
          className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
        >
          <span className="text-[14px] font-medium">{t('settings.changePin')}</span>
          <ChevronRight className="w-4 h-4 text-foreground-subtle" />
        </button>
      </div>
    </section>
  )
}
