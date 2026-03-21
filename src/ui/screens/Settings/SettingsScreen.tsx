import { useState, useCallback, useEffect, useMemo } from 'react'
import { ArrowLeft, AlertTriangle, Check, Copy, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { Modal, PinInput } from '../../components/common'
import { useAppStore } from '@/store'
import { encodeNpub } from '@/services/crypto'
import { satUnit } from '@/utils/format'
import { formatMintHost } from '@/utils/url'
import { restoreWallet, getBalances, recoverPendingQuotes } from '@/coco'
import { ZAPPI_LINK_URL } from '@/core/constants'
import { ProfileService } from '@/services/profile/profile.service'
import { NostrService } from '@/services/nostr/nostr.service'
import { ZappiLinkService } from '@/services/zappi-link'
import { cn } from '@/components/ui/utils'

import { PinChangeModal } from './PinChangeModal'
import { usePinChange } from './usePinChange'
import { SettingsMainList } from './SettingsMainList'
import { LanguageSettingPage } from './pages/LanguageSettingPage'
import { UnitDisplaySettingPage } from './pages/UnitDisplaySettingPage'
import { FiatSettingPage } from './pages/FiatSettingPage'
import {
  registerPasskey,
  removePasskey,
} from '@/services/passkey'
import { AutoLockSettingPage } from './pages/AutoLockSettingPage'
import { POSSettingPage } from './pages/POSSettingPage'

export type SettingsPage = 'language' | 'unitDisplay' | 'fiat' | 'autoLock' | 'pos'

export interface SettingsScreenProps {
  onBack: () => void
  onChangePassword: (oldPassword: string, newPassword: string) => Promise<boolean>
  onBackupMnemonic: (password: string) => Promise<string | null>
  onLogout: (password: string) => Promise<boolean>
  onVerifyPin: (pin: string) => Promise<boolean>
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
  onMintManagement?: () => void
  onRelayManagement?: () => void
  onChangeUsername?: () => void
  onTransfer?: () => void
  onAnalytics?: () => void
}

export function SettingsScreen({
  onBack,
  onChangePassword,
  onBackupMnemonic,
  onLogout,
  onVerifyPin,
  onSaveSettings,
  onMintManagement,
  onRelayManagement,
  onChangeUsername,
  onTransfer,
  onAnalytics,
}: SettingsScreenProps) {
  const { t } = useTranslation()
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const addToast = useAppStore((state) => state.addToast)
  const nostrPubkey = useAppStore((state) => state.nostrPubkey)
  const nostrPrivkey = useAppStore((state) => state.nostrPrivkey)
  const p2pkPubkey = useAppStore((state) => state.p2pkPubkey)
  const setBalance = useAppStore((state) => state.setBalance)

  // Internal sub-page navigation
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(null)

  // Lightning address registration
  const [isRegistering, setIsRegistering] = useState(false)

  // Backup modal
  const [showBackupModal, setShowBackupModal] = useState(false)
  const [backupPin, setBackupPin] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [backupError, setBackupError] = useState('')
  const [isLoadingBackup, setIsLoadingBackup] = useState(false)
  const [backupCopied, setBackupCopied] = useState(false)

  // Restore modal
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreProgress, setRestoreProgress] = useState('')
  const [restoreResult, setRestoreResult] = useState<{ success: boolean; message: string } | null>(null)

  // Logout modal
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [logoutPin, setLogoutPin] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  // PIN change
  const pinChange = usePinChange({
    onVerifyPin,
    onChangePassword,
    onPasskeyDesynced: () => {},
  })

  // Face ID
  const [showFaceIdModal, setShowFaceIdModal] = useState(false)
  const [faceIdAction, setFaceIdAction] = useState<'register' | 'remove'>('register')
  const [faceIdPin, setFaceIdPin] = useState('')
  const [faceIdError, setFaceIdError] = useState('')
  const [faceIdLoading, setFaceIdLoading] = useState(false)

  const handleFaceIdToggle = useCallback((enabled: boolean) => {
    setFaceIdAction(enabled ? 'register' : 'remove')
    setFaceIdPin('')
    setFaceIdError('')
    setShowFaceIdModal(true)
  }, [])

  const handleFaceIdSubmit = useCallback(async () => {
    if (faceIdPin.length !== 6) return
    setFaceIdLoading(true)
    setFaceIdError('')
    try {
      if (faceIdAction === 'register') {
        const success = await registerPasskey(faceIdPin)
        if (success) {
          setShowFaceIdModal(false)
        } else {
          setFaceIdError(t('settings.passkeyRegisterFailed'))
        }
      } else {
        const valid = await onVerifyPin(faceIdPin)
        if (valid) {
          removePasskey()
          setShowFaceIdModal(false)
        } else {
          setFaceIdError(t('settings.wrongPin'))
          setFaceIdPin('')
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'PRF_NOT_SUPPORTED') {
        setFaceIdError(t('settings.passkeyPRFNotSupported'))
      } else {
        setFaceIdError(t('lock.errorOccurred'))
      }
    } finally {
      setFaceIdLoading(false)
    }
  }, [faceIdPin, faceIdAction, onVerifyPin, t])

  // Save settings helper
  const saveSettings = useCallback(async (updates: Record<string, unknown>) => {
    updateSettings(updates)
    await onSaveSettings({ ...settings, ...updates })
  }, [settings, updateSettings, onSaveSettings])

  // Services for zappi-link registration
  const [services] = useState(() => ({
    profile: new ProfileService(),
    nostr: new NostrService(),
  }))
  const zappiLinkService = useMemo(
    () => new ZappiLinkService(services.nostr),
    [services.nostr]
  )

  // Auto-check existing address on mount
  useEffect(() => {
    if (!nostrPubkey || settings.lightningAddress) return
    zappiLinkService.getAddress(nostrPubkey).then((result) => {
      if (result.isOk() && result.value) {
        saveSettings({
          lightningAddress: result.value.address,
          zappiLinkApiUrl: ZAPPI_LINK_URL,
        })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nostrPubkey])

  const handleCopyNpub = useCallback(() => {
    if (nostrPubkey) {
      navigator.clipboard.writeText(encodeNpub(nostrPubkey))
      addToast({ type: 'success', message: t('toast.copied'), duration: 2000 })
    }
  }, [nostrPubkey, addToast, t])

  const handleRegisterLightningAddress = useCallback(async () => {
    if (!nostrPrivkey || !p2pkPubkey) return
    setIsRegistering(true)
    try {
      await services.profile.publishNutzapInfo(
        nostrPrivkey,
        settings.mints,
        p2pkPubkey,
        settings.relays,
      )
      const result = await zappiLinkService.registerAddress(nostrPrivkey)
      if (result.isErr()) {
        addToast({ type: 'error', message: t('settings.lightningAddressRegistrationFailed') })
        return
      }
      await saveSettings({
        lightningAddress: result.value.address,
        zappiLinkApiUrl: ZAPPI_LINK_URL,
      })
      addToast({ type: 'success', message: t('settings.lightningAddressRegistered') })
    } catch {
      addToast({ type: 'error', message: t('settings.lightningAddressRegistrationFailed') })
    } finally {
      setIsRegistering(false)
    }
  }, [nostrPrivkey, p2pkPubkey, settings.mints, settings.relays, services.profile, zappiLinkService, saveSettings, addToast, t])

  // Backup handlers
  const handleBackupMnemonic = useCallback(async () => {
    if (backupPin.length !== 6) return
    setIsLoadingBackup(true)
    setBackupError('')
    try {
      const result = await onBackupMnemonic(backupPin)
      if (result) {
        setMnemonic(result)
      } else {
        setBackupError(t('settings.wrongPin'))
        setBackupPin('')
      }
    } catch {
      setBackupError(t('lock.errorOccurred'))
    } finally {
      setIsLoadingBackup(false)
    }
  }, [backupPin, onBackupMnemonic, t])

  const resetBackupModal = useCallback(() => {
    setShowBackupModal(false)
    setBackupPin('')
    setMnemonic('')
    setBackupError('')
    setBackupCopied(false)
  }, [])

  // Logout handlers
  const handleLogout = useCallback(async () => {
    if (logoutPin.length !== 6) return
    setIsLoggingOut(true)
    setLogoutError('')
    try {
      const success = await onLogout(logoutPin)
      if (!success) {
        setLogoutError(t('settings.wrongPin'))
        setLogoutPin('')
      }
    } catch {
      setLogoutError(t('lock.errorOccurred'))
    } finally {
      setIsLoggingOut(false)
    }
  }, [logoutPin, onLogout, t])

  // Restore handlers
  const handleRestoreTokens = useCallback(async () => {
    const mints = settings.mints
    if (mints.length === 0) {
      setRestoreResult({ success: false, message: t('settings.noMintsRegistered') })
      return
    }
    setIsRestoring(true)
    setRestoreResult(null)
    try {
      const beforeBalances = await getBalances()
      const beforeTotal = Object.values(beforeBalances).reduce((sum, b) => sum + b, 0)

      setRestoreProgress(t('settings.recoveringLightning'))
      try {
        const recoveryResult = await recoverPendingQuotes()
        if (recoveryResult.recovered > 0) console.log('[Settings] Recovered pending quotes:', recoveryResult)
      } catch (err) {
        console.warn('[Settings] Failed to recover pending quotes:', err)
      }

      for (let i = 0; i < mints.length; i++) {
        const mintUrl = mints[i]
        setRestoreProgress(`${i + 1}/${mints.length}: ${formatMintHost(mintUrl)}`)
        try {
          await restoreWallet(mintUrl)
        } catch (err) {
          console.warn('[Settings] Failed to restore from:', mintUrl, err)
        }
      }

      const afterBalances = await getBalances()
      const afterTotal = Object.values(afterBalances).reduce((sum, b) => sum + b, 0)

      const recovered = afterTotal - beforeTotal
      if (recovered > 0) {
        setRestoreResult({ success: true, message: t('settings.recoveredAmount', { amount: recovered.toLocaleString(), unit: satUnit() }) })
      } else {
        setRestoreResult({ success: true, message: t('settings.noMissingBalance') })
      }
      setBalance({ total: afterTotal, byMint: afterBalances })
    } catch {
      setRestoreResult({ success: false, message: t('settings.verificationError') })
    } finally {
      setIsRestoring(false)
      setRestoreProgress('')
    }
  }, [settings.mints, setBalance, t])

  // Render sub-page
  const renderPage = () => {
    switch (settingsPage) {
      case 'language':
        return <LanguageSettingPage onBack={() => setSettingsPage(null)} />
      case 'unitDisplay':
        return <UnitDisplaySettingPage onBack={() => setSettingsPage(null)} saveSettings={saveSettings} />
      case 'fiat':
        return <FiatSettingPage onBack={() => setSettingsPage(null)} saveSettings={saveSettings} />
      case 'autoLock':
        return <AutoLockSettingPage onBack={() => setSettingsPage(null)} saveSettings={saveSettings} />
      case 'pos':
        return (
          <POSSettingPage
            onBack={() => setSettingsPage(null)}
            settings={settings}
            nostrPubkey={nostrPubkey}
            nostrPrivkey={nostrPrivkey}
            onBackupMnemonic={onBackupMnemonic}
            onSaveSettings={saveSettings}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden z-[60]">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border relative z-50">
        <button onClick={onBack} aria-label={t('common.back')} className="p-1">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h2 className="text-body font-semibold tracking-tight">{t('settings.title')}</h2>
      </header>

      {/* Main list */}
      <SettingsMainList
        onNavigate={setSettingsPage}
        onCopyNpub={handleCopyNpub}
        onRegisterLightningAddress={handleRegisterLightningAddress}
        isRegistering={isRegistering}
        onOpenUsernameChange={onChangeUsername}
        onMintManagement={onMintManagement}
        onRelayManagement={onRelayManagement}
        onTransfer={onTransfer}
        onAnalytics={onAnalytics}
        onFaceIdToggle={handleFaceIdToggle}
        onOpenPinChange={pinChange.open}
        onOpenRestore={() => setShowRestoreModal(true)}
        onOpenBackup={() => setShowBackupModal(true)}
        onOpenLogout={() => setShowLogoutModal(true)}
      />

      {/* Sub-page overlay */}
      <AnimatePresence mode="wait">
        {settingsPage && (
          <PageTransition key={settingsPage} variant="page" className="absolute inset-0 z-[65]">
            {renderPage()}
          </PageTransition>
        )}
      </AnimatePresence>

      {/* PIN Change Modal */}
      <PinChangeModal pinChange={pinChange} />

      {/* Face ID PIN Modal */}
      <Modal
        isOpen={showFaceIdModal}
        onClose={() => { setShowFaceIdModal(false); setFaceIdPin(''); setFaceIdError('') }}
        title={t('settings.faceIdTouchId')}
      >
        <div className="py-3">
          <PinInput
            value={faceIdPin}
            onChange={(v) => { setFaceIdPin(v); setFaceIdError('') }}
            label={faceIdAction === 'register' ? t('settings.passkeyDescription') : t('settings.passkeyRemoveDescription')}
            error={faceIdError}
            submitLabel={faceIdAction === 'register' ? t('settings.register') : t('settings.remove')}
            onSubmit={handleFaceIdSubmit}
            loading={faceIdLoading}
          />
        </div>
      </Modal>

      {/* Backup Modal */}
      <Modal isOpen={showBackupModal} onClose={resetBackupModal} title={t('settings.mnemonicBackup')}>
        {!mnemonic ? (
          <div className="py-3">
            <PinInput
              value={backupPin}
              onChange={(v) => { setBackupPin(v); setBackupError('') }}
              label={t('settings.enterPinLabel')}
              error={backupError}
              submitLabel={t('common.confirm')}
              onSubmit={handleBackupMnemonic}
              loading={isLoadingBackup}
            />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-caption text-foreground-muted leading-relaxed whitespace-pre-line">
              {t('settings.mnemonicWarning')}
            </p>
            <div className="bg-background-card rounded-xl p-4">
              {(() => {
                const mnemonicWords = mnemonic.split(' ')
                const cols = mnemonicWords.length > 12 ? 'grid-cols-3' : 'grid-cols-2'
                return (
                  <div className={`grid ${cols} gap-x-3 gap-y-0`}>
                    {mnemonicWords.map((word, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-2 py-2.5 ${
                          i < mnemonicWords.length - (mnemonicWords.length > 12 ? 3 : 2)
                            ? 'border-b border-border'
                            : ''
                        }`}
                      >
                        <span className="text-label tabular-nums text-foreground-subtle w-5 text-right shrink-0">{i + 1}</span>
                        <span className="text-body font-medium text-foreground">{word}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
            <div className="flex items-center justify-center">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(mnemonic)
                  setBackupCopied(true)
                  setTimeout(() => setBackupCopied(false), 2000)
                }}
                className="flex items-center gap-1.5 text-caption font-medium text-foreground-muted active:opacity-60 transition-opacity px-3 py-2"
              >
                {backupCopied ? <Check className="w-4 h-4 text-brand" /> : <Copy className="w-4 h-4" />}
                {backupCopied ? t('common.copied') : t('onboarding.copyToClipboard')}
              </button>
            </div>
            <button
              onClick={resetBackupModal}
              className="w-full py-3.5 rounded-xl font-semibold text-caption bg-brand text-white active:opacity-80 transition-all"
            >
              {t('common.close')}
            </button>
          </div>
        )}
      </Modal>

      {/* Logout Modal */}
      <Modal
        isOpen={showLogoutModal}
        onClose={() => { setShowLogoutModal(false); setLogoutPin(''); setLogoutError('') }}
        title={t('settings.logout')}
      >
        <div className="py-3">
          <div className="flex flex-col items-center text-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-accent-danger/[0.08] flex items-center justify-center text-accent-danger">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <p className="text-label text-foreground-muted">
              {t('settings.logoutWarning')}
            </p>
          </div>
          <PinInput
            value={logoutPin}
            onChange={(v) => { setLogoutPin(v); setLogoutError('') }}
            label={t('settings.enterPinLabel')}
            error={logoutError}
            submitLabel={t('settings.logout')}
            onSubmit={handleLogout}
            loading={isLoggingOut}
          />
        </div>
      </Modal>

      {/* Token Restore Modal */}
      <Modal
        isOpen={showRestoreModal}
        onClose={() => { if (!isRestoring) { setShowRestoreModal(false); setRestoreResult(null) } }}
        title={t('settings.verifyBalance')}
      >
        <div className="space-y-3">
          {!isRestoring && !restoreResult && (
            <>
              <p className="text-label text-foreground-muted">
                {t('settings.restoreDescription')}
              </p>
              <p className="text-label text-foreground-muted">{t('settings.registeredMints', { count: settings.mints.length })}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowRestoreModal(false)}
                  className="flex-1 py-2.5 rounded-xl bg-background text-foreground font-semibold text-caption active:opacity-80 border border-border"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleRestoreTokens}
                  className="flex-1 py-2.5 rounded-xl bg-brand text-white font-semibold text-caption active:opacity-80"
                >
                  {t('settings.startVerification')}
                </button>
              </div>
            </>
          )}
          {isRestoring && (
            <div className="text-center py-6">
              <div className="relative mb-4 mx-auto w-16 h-16">
                <div
                  className="w-16 h-16 rounded-full border-4 border-foreground/10 border-t-foreground animate-spin"
                  style={{ animationDuration: '2s' }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-foreground" />
                </div>
              </div>
              <p className="font-semibold text-foreground">{t('settings.verifying')}</p>
              {restoreProgress && <p className="text-overline text-foreground-muted mt-2">{restoreProgress}</p>}
            </div>
          )}
          {restoreResult && (
            <div className="text-center py-3">
              <div className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3',
                restoreResult.success ? 'bg-accent-primary/[0.1] text-accent-primary' : 'bg-accent-danger/[0.1] text-accent-danger'
              )}>
                {restoreResult.success ? <Check className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
              </div>
              <p className="font-semibold text-foreground">{restoreResult.message}</p>
              <button
                onClick={() => { setShowRestoreModal(false); setRestoreResult(null) }}
                className="w-full mt-3 py-2.5 rounded-xl bg-brand text-white font-semibold text-caption active:opacity-80"
              >
                {t('common.confirm')}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

export default SettingsScreen
