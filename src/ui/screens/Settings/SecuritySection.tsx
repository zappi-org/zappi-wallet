import { ChevronRight, ChevronsUpDown, Shield } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@/ui/components/common/Switch'

export interface SecuritySectionProps {
  autoLockEnabled: boolean
  autoLockTimeout: number
  passkeySupported: boolean
  passkeyEnabled: boolean
  onAutoLockToggle: (enabled: boolean) => void
  onAutoLockTimeoutChange: (value: number) => void
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
        {/* Change PIN */}
        <button
          onClick={onOpenPinChange}
          className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
        >
          <span className="text-[14px] font-medium">{t('settings.changePin')}</span>
          <ChevronRight className="w-4 h-4 text-foreground-subtle" />
        </button>

        {/* Biometrics */}
        {passkeySupported && (
          <div className="px-4 py-3.5 flex items-center justify-between">
            <span className="text-[14px] font-medium">{t('settings.faceIdTouchId')}</span>
            <Switch checked={passkeyEnabled} onChange={onPasskeyToggle} />
          </div>
        )}

        {/* Auto Lock Toggle */}
        <div className="px-4 py-3.5 flex items-center justify-between">
          <span className="text-[14px] font-medium">{t('settings.autoLock')}</span>
          <Switch checked={autoLockEnabled} onChange={onAutoLockToggle} />
        </div>

        {/* Auto Lock Timeout — sub-row when enabled */}
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: autoLockEnabled ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <AutoLockTimeoutPicker
              value={autoLockTimeout}
              onChange={onAutoLockTimeoutChange}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

const TIMEOUT_OPTIONS = [1, 3, 5, 10, 15, 30]

function AutoLockTimeoutPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation()
  const currentIndex = TIMEOUT_OPTIONS.indexOf(value)

  const cycleNext = () => {
    const nextIndex = ((currentIndex === -1 ? 2 : currentIndex) + 1) % TIMEOUT_OPTIONS.length
    onChange(TIMEOUT_OPTIONS[nextIndex])
  }

  return (
    <button
      onClick={cycleNext}
      className="w-full px-4 py-3.5 flex items-center justify-between active:bg-background-hover text-left"
    >
      <span className="text-[14px] text-foreground-muted">{t('settings.autoLockTimeout')}</span>
      <div className="flex items-center gap-1">
        <span className="text-[14px] text-foreground-muted">
          {value}{t('common.min')}
        </span>
        <ChevronsUpDown className="w-3.5 h-3.5 text-foreground-subtle" />
      </div>
    </button>
  )
}
