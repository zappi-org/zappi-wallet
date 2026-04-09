import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { PinInput } from '@/ui/components/common'
import { Switch } from '@/ui/components/common/Switch'
import {
  isPasskeySupported,
  isPasskeyRegistered,
  registerPasskey,
  removePasskey,
} from '@/ui/services/passkey'
import { SettingsDetailPage } from '../components/SettingsDetailPage'

interface FaceIdSettingPageProps {
  onBack: () => void
  onVerifyPin: (pin: string) => Promise<boolean>
}

export function FaceIdSettingPage({ onBack, onVerifyPin }: FaceIdSettingPageProps) {
  const { t } = useTranslation()

  const [supported, setSupported] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [action, setAction] = useState<'register' | 'remove'>('register')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setSupported(isPasskeySupported())
    setEnabled(isPasskeyRegistered())
  }, [])

  const handleToggle = useCallback((value: boolean) => {
    setAction(value ? 'register' : 'remove')
    setShowPin(true)
    setPin('')
    setError('')
  }, [])

  const handleSubmit = useCallback(async () => {
    if (pin.length !== 6) return
    setLoading(true)
    setError('')

    try {
      if (action === 'register') {
        const success = await registerPasskey(pin)
        if (success) {
          setEnabled(true)
          setShowPin(false)
        } else {
          setError(t('settings.passkeyRegisterFailed'))
        }
      } else {
        const valid = await onVerifyPin(pin)
        if (valid) {
          removePasskey()
          setEnabled(false)
          setShowPin(false)
        } else {
          setError(t('settings.wrongPin'))
          setPin('')
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'PRF_NOT_SUPPORTED') {
        setError(t('settings.passkeyPRFNotSupported'))
      } else {
        setError(t('lock.errorOccurred'))
      }
    } finally {
      setLoading(false)
    }
  }, [pin, action, onVerifyPin, t])

  return (
    <SettingsDetailPage title={t('settings.faceIdTouchId')} onBack={onBack}>
      {/* Toggle */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-border">
        <div>
          <p className="text-body font-medium">{t('settings.faceIdTouchId')}</p>
          <p className="text-caption text-foreground-muted mt-0.5">{t('settings.faceIdDescription')}</p>
        </div>
        <Switch
          checked={enabled}
          onChange={handleToggle}
          disabled={!supported || loading}
        />
      </div>

      {!supported && (
        <div className="px-5 py-4">
          <p className="text-caption text-foreground-muted">{t('settings.passkeyPRFNotSupported')}</p>
        </div>
      )}

      {/* PIN verification */}
      {showPin && (
        <div className="px-5 py-6">
          <PinInput
            value={pin}
            onChange={(v) => { setPin(v); setError('') }}
            label={action === 'register' ? t('settings.passkeyDescription') : t('settings.passkeyRemoveDescription')}
            error={error}
            submitLabel={action === 'register' ? t('settings.register') : t('settings.remove')}
            onSubmit={handleSubmit}
            loading={loading}
          />
        </div>
      )}
    </SettingsDetailPage>
  )
}
