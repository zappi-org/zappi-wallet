import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { encodeNpub } from '@/services/crypto'
import { FIAT_CURRENCY_MAP } from '@/utils/format'
import { isPasskeySupported, isPasskeyRegistered } from '@/services/passkey'
import { getCurrentLanguage, SUPPORTED_LANGUAGES } from '@/i18n'
import { updateSW } from '@/registerSW'
import { Switch } from '@/ui/components/common/Switch'
import { SettingsRow } from './components/SettingsRow'
import type { SettingsPage } from './SettingsScreen'

interface SettingsMainListProps {
  onNavigate: (page: SettingsPage) => void
  onCopyNpub: () => void
  onRegisterLightningAddress: () => void
  isRegistering: boolean
  onOpenUsernameChange?: () => void
  onMintManagement?: () => void
  onRelayManagement?: () => void
  onTransfer?: () => void
  onAnalytics?: () => void
  onFaceIdToggle: (enabled: boolean) => void
  onOpenPinChange: () => void
  onOpenRestore: () => void
  onOpenBackup: () => void
  onOpenLogout: () => void
}

export function SettingsMainList({
  onNavigate,
  onCopyNpub,
  onRegisterLightningAddress,
  isRegistering,
  onOpenUsernameChange,
  onMintManagement,
  onRelayManagement,
  onTransfer,
  onAnalytics,
  onFaceIdToggle,
  onOpenPinChange,
  onOpenRestore,
  onOpenBackup,
  onOpenLogout,
}: SettingsMainListProps) {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const updateAvailable = useAppStore((s) => s.updateAvailable)

  const currentLang = getCurrentLanguage()
  const langName = SUPPORTED_LANGUAGES.find(l => l.code === currentLang)?.nativeName || 'English'
  const unitLabel = (settings.unitDisplay ?? 'bip177') === 'sats' ? 'sats' : '₿ (BIP-177)'
  const showFiat = settings.showFiatConversion ?? true
  const fiatValue = showFiat
    ? (() => {
        const code = settings.fiatCurrency ?? 'USD'
        const info = FIAT_CURRENCY_MAP.get(code)
        return info ? `${info.flag} ${info.symbol} ${code}` : code
      })()
    : null

  const autoLockEnabled = settings.autoLockEnabled
  const autoLockValue = autoLockEnabled ? `${settings.autoLockTimeoutMinutes}${t('common.min')}` : null

  const passkeySupported = isPasskeySupported()
  const passkeyEnabled = isPasskeyRegistered()

  const posDevices = settings.posDevices ?? []
  const posValue = posDevices.length > 0 ? t('settings.posDeviceCount', { count: posDevices.length }) : null

  const npubDisplay = nostrPubkey ? encodeNpub(nostrPubkey) : null

  return (
    <div className="flex-1 overflow-y-auto pb-safe">
      {/* Update banner */}
      {updateAvailable && (
        <button
          onClick={() => updateSW()}
          className="w-full bg-brand text-white px-4 py-3 font-semibold text-caption flex items-center justify-center gap-2 active:opacity-80"
        >
          <Download className="w-4 h-4" />
          {t('settings.updateAvailable')}
        </button>
      )}

      {/* Profile */}
      <section>
        <p className="text-overline uppercase tracking-wide text-foreground-muted px-4 pt-6 pb-2">
          {t('settings.profile')}
        </p>
        <div className="bg-background-card">
          {npubDisplay && (
            <SettingsRow
              label="npub"
              value={npubDisplay}
              onPress={onCopyNpub}
              variant="copy"
              truncateValue
            />
          )}
          {settings.lightningAddress ? (
            <SettingsRow
              label={t('settings.lightningAddress')}
              value={settings.lightningAddress}
              onPress={() => onOpenUsernameChange?.()}
            />
          ) : (
            <SettingsRow
              label={t('settings.lightningAddress')}
              value={isRegistering ? t('settings.registeringLightningAddress') : t('settings.registerLightningAddress')}
              onPress={onRegisterLightningAddress}
            />
          )}
          <SettingsRow
            label={t('actions.analytics')}
            onPress={() => onAnalytics?.()}
          />
        </div>
      </section>

      {/* Preferences */}
      <section>
        <p className="text-overline uppercase tracking-wide text-foreground-muted px-4 pt-6 pb-2">
          {t('settings.preferences')}
        </p>
        <div className="bg-background-card">
          <SettingsRow
            label={t('settings.language')}
            value={langName}
            onPress={() => onNavigate('language')}
          />
          <SettingsRow
            label={t('settings.unitDisplay')}
            value={unitLabel}
            onPress={() => onNavigate('unitDisplay')}
          />
          <SettingsRow
            label={t('settings.showFiatConversion')}
            value={fiatValue}
            onPress={() => onNavigate('fiat')}
          />
        </div>
      </section>

      {/* Security */}
      <section>
        <p className="text-overline uppercase tracking-wide text-foreground-muted px-4 pt-6 pb-2">
          {t('settings.security')}
        </p>
        <div className="bg-background-card">
          <SettingsRow
            label={t('settings.changePin')}
            onPress={onOpenPinChange}
          />
          {passkeySupported && (
            <div className="px-4 py-3.5 flex items-center justify-between min-h-[52px]">
              <span className="text-body font-medium">{t('settings.faceIdTouchId')}</span>
              <Switch checked={passkeyEnabled} onChange={onFaceIdToggle} />
            </div>
          )}
          <SettingsRow
            label={t('settings.autoLock')}
            value={autoLockValue}
            onPress={() => onNavigate('autoLock')}
          />
        </div>
      </section>

      {/* Wallet Management */}
      <section>
        <p className="text-overline uppercase tracking-wide text-foreground-muted px-4 pt-6 pb-2">
          {t('settings.walletManagement')}
        </p>
        <div className="bg-background-card">
          <SettingsRow
            label={t('settings.manageMints')}
            value={String(settings.mints.length)}
            onPress={() => onMintManagement?.()}
          />
          <SettingsRow
            label={t('settings.manageRelays')}
            value={String(settings.relays.length)}
            onPress={() => onRelayManagement?.()}
          />
          <SettingsRow
            label={t('actions.transfer')}
            onPress={() => onTransfer?.()}
          />
          <SettingsRow
            label={t('settings.verifyBalance')}
            onPress={onOpenRestore}
          />
          <SettingsRow
            label={t('settings.mnemonicBackup')}
            onPress={onOpenBackup}
          />
        </div>
      </section>

      {/* POS Management */}
      {(posDevices.length > 0 || settings.lightningAddress) && (
        <section>
          <p className="text-overline uppercase tracking-wide text-foreground-muted px-4 pt-6 pb-2">
            {t('settings.posManagement')}
          </p>
          <div className="bg-background-card">
            <SettingsRow
              label={t('settings.posManagement')}
              value={posValue}
              onPress={() => onNavigate('pos')}
            />
          </div>
        </section>
      )}

      {/* Logout */}
      <div className="px-4 pt-8">
        <button
          onClick={onOpenLogout}
          className="w-full py-3.5 bg-accent-danger text-white text-body font-semibold flex items-center justify-center gap-2 rounded-xl active:opacity-80 transition-opacity"
        >
          {t('settings.logout')}
        </button>
        <p className="text-center mt-4 text-overline text-foreground-muted/50 uppercase tracking-widest">
          {t('settings.version')}
        </p>
      </div>
    </div>
  )
}
