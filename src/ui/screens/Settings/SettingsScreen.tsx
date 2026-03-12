import { useState, useCallback, useEffect, useMemo } from 'react'

import { ArrowLeft, ChevronRight, Check, AlertTriangle, LogOut, Globe, ShieldCheck, Download, ArrowLeftRight, BarChart3, Coins } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, Modal, BottomSheet, PinInput } from '../../components/common'
import { useAppStore } from '@/store'
import { encodeNpub } from '@/services/crypto'
import { normalizeRelayUrl } from '@/utils/url'
import { satUnit } from '@/utils/format'
import { restoreWallet, getBalances, recoverPendingQuotes } from '@/coco'
import { LIMITS, ZAPPI_LINK_URL } from '@/core/constants'
import { ProfileService } from '@/services/profile/profile.service'
import { NostrService } from '@/services/nostr/nostr.service'
import { ZappiLinkService } from '@/services/zappi-link'
import {
  isPasskeySupported,
  isPasskeyRegistered,
  registerPasskey,
  removePasskey,
  updatePasskeyPin,
} from '@/services/passkey'
import { cn } from '@/components/ui/utils'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { useMintHealth } from '@/hooks/use-mint-health'
import { type MintInfo } from '@/ui/components/modals/MintDetailsModal'
import { SUPPORTED_LANGUAGES, changeLanguage, getCurrentLanguage } from '@/i18n'
import { updateSW } from '@/registerSW'

import { ProfileSection } from './ProfileSection'
import { SecuritySection } from './SecuritySection'
import { WalletManagementSection } from './WalletManagementSection'
import { POSProvisioningSection } from './POSProvisioningSection'
import { MintsBottomSheet } from './MintsBottomSheet'
import { RelaysBottomSheet } from './RelaysBottomSheet'
import { PinChangeModal, type PinChangeStep } from './PinChangeModal'

export interface SettingsScreenProps {
  onBack: () => void
  onChangePassword: (oldPassword: string, newPassword: string) => Promise<boolean>
  onBackupMnemonic: (password: string) => Promise<string | null>
  onLogout: (password: string) => Promise<boolean>
  onVerifyPin: (pin: string) => Promise<boolean>
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
  onAddMint?: () => void
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
  onAddMint,
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
  const balanceByMint = useAppStore((state) => state.balance.byMint)
  const updateAvailable = useAppStore((state) => state.updateAvailable)

  const [showLanguageModal, setShowLanguageModal] = useState(false)
  const [currentLang, setCurrentLang] = useState(getCurrentLanguage())

  const [isRegistering, setIsRegistering] = useState(false)
  const [autoLockEnabled, setAutoLockEnabled] = useState(settings.autoLockEnabled)
  const [autoLockTimeout, setAutoLockTimeout] = useState(String(settings.autoLockTimeoutMinutes))

  const [showMintsModal, setShowMintsModal] = useState(false)
  const [showRelaysModal, setShowRelaysModal] = useState(false)
  const [newRelayUrl, setNewRelayUrl] = useState('')
  const [isValidatingRelay, setIsValidatingRelay] = useState(false)
  const [relayError, setRelayError] = useState('')
  const [mintToDelete, setMintToDelete] = useState<string | null>(null)

  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showBackupModal, setShowBackupModal] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)

  const [pinChangeStep, setPinChangeStep] = useState<PinChangeStep>('current')
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [isVerifyingPin, setIsVerifyingPin] = useState(false)
  const [isChangingPin, setIsChangingPin] = useState(false)

  const [backupPin, setBackupPin] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [backupError, setBackupError] = useState('')
  const [isLoadingBackup, setIsLoadingBackup] = useState(false)

  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreProgress, setRestoreProgress] = useState('')
  const [restoreResult, setRestoreResult] = useState<{ success: boolean; message: string } | null>(null)

  const [logoutPin, setLogoutPin] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const [isLoggingOut, setIsLoggingOut] = useState(false)

  const [npubCopied, setNpubCopied] = useState(false)

  const [selectedMint, setSelectedMint] = useState<MintInfo | null>(null)
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)
  const { getCachedStatus, checkAllMints } = useMintHealth()

  // Check mint health on mount
  useEffect(() => {
    checkAllMints()
  }, [checkAllMints])

  const [passkeySupported, setPasskeySupported] = useState(false)
  const [passkeyEnabled, setPasskeyEnabled] = useState(false)
  const [showPasskeyModal, setShowPasskeyModal] = useState(false)
  const [showPasskeyRemoveModal, setShowPasskeyRemoveModal] = useState(false)
  const [passkeyPin, setPasskeyPin] = useState('')
  const [passkeyError, setPasskeyError] = useState('')
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false)
  const [isRemovingPasskey, setIsRemovingPasskey] = useState(false)

  useEffect(() => {
    setPasskeySupported(isPasskeySupported())
    setPasskeyEnabled(isPasskeyRegistered())
  }, [])

  const handleCopyNpub = useCallback(() => {
    if (nostrPubkey) {
      navigator.clipboard.writeText(encodeNpub(nostrPubkey))
      setNpubCopied(true)
      setTimeout(() => setNpubCopied(false), 2000)
      addToast({ type: 'success', message: t('toast.copied'), duration: 2000 })
    }
  }, [nostrPubkey, addToast, t])

  const handlePasskeyToggle = useCallback((enabled: boolean) => {
    if (enabled) {
      setShowPasskeyModal(true)
    } else {
      setShowPasskeyRemoveModal(true)
    }
    setPasskeyPin('')
    setPasskeyError('')
  }, [])

  const handlePasskeyPinChange = useCallback((value: string) => {
    setPasskeyPin(value)
    setPasskeyError('')
  }, [])

  const handlePasskeyRegister = useCallback(async () => {
    if (passkeyPin.length !== 6) return
    setIsRegisteringPasskey(true)
    setPasskeyError('')
    try {
      const success = await registerPasskey(passkeyPin)
      if (success) {
        setPasskeyEnabled(true)
        setShowPasskeyModal(false)
        setPasskeyPin('')
      } else {
        setPasskeyError(t('settings.passkeyRegisterFailed'))
      }
    } catch (err) {
      if (err instanceof Error && err.message === 'PRF_NOT_SUPPORTED') {
        setPasskeyError(t('settings.passkeyPRFNotSupported'))
      } else {
        setPasskeyError(t('lock.errorOccurred'))
      }
    } finally {
      setIsRegisteringPasskey(false)
    }
  }, [passkeyPin, t])

  const handlePasskeyRemove = useCallback(async () => {
    if (passkeyPin.length !== 6) return
    setIsRemovingPasskey(true)
    setPasskeyError('')
    try {
      const valid = await onVerifyPin(passkeyPin)
      if (valid) {
        removePasskey()
        setPasskeyEnabled(false)
        setShowPasskeyRemoveModal(false)
        setPasskeyPin('')
      } else {
        setPasskeyError(t('settings.wrongPin'))
        setPasskeyPin('')
      }
    } catch {
      setPasskeyError(t('lock.errorOccurred'))
    } finally {
      setIsRemovingPasskey(false)
    }
  }, [passkeyPin, onVerifyPin, t])

  const resetPasskeyModal = useCallback(() => {
    setShowPasskeyModal(false)
    setShowPasskeyRemoveModal(false)
    setPasskeyPin('')
    setPasskeyError('')
  }, [])

  const handleLanguageChange = useCallback((langCode: string) => {
    changeLanguage(langCode as 'ko' | 'en' | 'es' | 'ja' | 'id')
    setCurrentLang(langCode as 'ko' | 'en' | 'es' | 'ja' | 'id')
    setShowLanguageModal(false)
  }, [])

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

  const handleRegisterLightningAddress = useCallback(async () => {
    if (!nostrPrivkey || !p2pkPubkey) return
    setIsRegistering(true)

    try {
      // 1. Publish Kind 10019 so zappi-link can read mints/relays/p2pk
      await services.profile.publishNutzapInfo(
        nostrPrivkey,
        settings.mints,
        p2pkPubkey,
        settings.relays,
      )

      // 2. Register address via NIP-98
      const result = await zappiLinkService.registerAddress(nostrPrivkey)
      if (result.isErr()) {
        console.error('[Settings] Lightning Address registration failed:', result.error)
        addToast({ type: 'error', message: t('settings.lightningAddressRegistrationFailed') })
        return
      }

      // 3. Save to settings
      await saveSettings({
        lightningAddress: result.value.address,
        zappiLinkApiUrl: ZAPPI_LINK_URL,
      })
      addToast({ type: 'success', message: t('settings.lightningAddressRegistered') })
    } catch (error) {
      console.error('[Settings] Lightning Address registration error:', error)
      addToast({ type: 'error', message: t('settings.lightningAddressRegistrationFailed') })
    } finally {
      setIsRegistering(false)
    }
  }, [nostrPrivkey, p2pkPubkey, settings.mints, settings.relays, services.profile, zappiLinkService, saveSettings, addToast, t])

  const handleAutoLockToggle = useCallback(async (enabled: boolean) => {
    setAutoLockEnabled(enabled)
    await saveSettings({ autoLockEnabled: enabled })
  }, [saveSettings])

  const handleAutoLockTimeoutChange = useCallback(async (value: string) => {
    const numValue = parseInt(value, 10)
    if (!isNaN(numValue) && numValue >= 1 && numValue <= 60) {
      setAutoLockTimeout(value)
      await saveSettings({ autoLockTimeoutMinutes: numValue })
    } else {
      setAutoLockTimeout(value)
    }
  }, [saveSettings])


  const handleRemoveMint = useCallback((url: string) => {
    // Normalize URL for balance lookup (remove trailing slash)
    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url
    const mintBalance = balanceByMint[normalizedUrl] || balanceByMint[url] || 0
    if (mintBalance > 0) {
      setMintToDelete(url)
    } else {
      const newMints = settings.mints.filter((m) => m !== url)
      saveSettings({ mints: newMints })
    }
  }, [settings.mints, saveSettings, balanceByMint])

  const confirmRemoveMint = useCallback(async () => {
    if (!mintToDelete) return
    const newMints = settings.mints.filter((m) => m !== mintToDelete)
    await saveSettings({ mints: newMints })
    setMintToDelete(null)
  }, [mintToDelete, settings.mints, saveSettings])

  const handleAddRelay = useCallback(async () => {
    if (!newRelayUrl.trim()) return
    setRelayError('')

    // Check limit
    if (settings.relays.length >= LIMITS.MAX_RELAYS) {
      setRelayError(t('settings.maxRelaysReached', { max: LIMITS.MAX_RELAYS }))
      return
    }

    const url = normalizeRelayUrl(newRelayUrl)

    if (settings.relays.includes(url)) {
      setRelayError(t('settings.relayExists'))
      return
    }

    setIsValidatingRelay(true)
    try {
      const ws = new WebSocket(url)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error('Connection timeout')) }, 5000)
        ws.onopen = () => { clearTimeout(timeout); ws.close(); resolve() }
        ws.onerror = () => { clearTimeout(timeout); reject(new Error('Connection failed')) }
      })
      const newRelays = [...settings.relays, url]
      await saveSettings({ relays: newRelays })
      setNewRelayUrl('')
    } catch {
      setRelayError(t('settings.relayConnectionFailed'))
    } finally {
      setIsValidatingRelay(false)
    }
  }, [newRelayUrl, settings.relays, saveSettings, t])

  const handleRemoveRelay = useCallback(async (url: string) => {
    const newRelays = settings.relays.filter((r) => r !== url)
    await saveSettings({ relays: newRelays })
  }, [settings.relays, saveSettings])

  const handleCurrentPinChange = useCallback((value: string) => {
    setCurrentPin(value)
    setPinError('')
  }, [])

  const handleNewPinChange = useCallback((value: string) => {
    setNewPin(value)
    setPinError('')
    if (value.length === 6) {
      setTimeout(() => setPinChangeStep('confirm'), 200)
    }
  }, [])

  const handleConfirmPinChange = useCallback((value: string) => {
    setConfirmPin(value)
    setPinError('')
  }, [])

  const handlePinChangeSubmit = useCallback(async () => {
    if (newPin !== confirmPin) {
      setPinError(t('settings.pinChangeError'))
      setConfirmPin('')
      return
    }
    setIsChangingPin(true)
    setPinError('')
    try {
      const success = await onChangePassword(currentPin, newPin)
      if (success) {
        if (isPasskeyRegistered()) {
          const pinUpdated = await updatePasskeyPin(newPin)
          if (!pinUpdated) {
            // Passkey PIN desync — remove passkey to prevent stale PIN login failure
            removePasskey()
            setPasskeyEnabled(false)
          }
        }
        setShowPasswordModal(false)
        setPinChangeStep('current')
        setCurrentPin('')
        setNewPin('')
        setConfirmPin('')
      } else {
        setPinError(t('settings.wrongCurrentPin'))
        setPinChangeStep('current')
        setCurrentPin('')
        setNewPin('')
        setConfirmPin('')
      }
    } catch {
      setPinError(t('lock.errorOccurred'))
    } finally {
      setIsChangingPin(false)
    }
  }, [newPin, confirmPin, currentPin, onChangePassword, t])

  const resetPinChangeModal = useCallback(() => {
    setShowPasswordModal(false)
    setPinChangeStep('current')
    setCurrentPin('')
    setNewPin('')
    setConfirmPin('')
    setPinError('')
  }, [])

  const handleCurrentPinSubmit = useCallback(async () => {
    if (currentPin.length !== 6) return
    setIsVerifyingPin(true)
    setPinError('')
    try {
      const valid = await onVerifyPin(currentPin)
      if (valid) {
        setPinChangeStep('new')
      } else {
        setPinError(t('settings.wrongPin'))
        setCurrentPin('')
      }
    } catch {
      setPinError(t('lock.errorOccurred'))
    } finally {
      setIsVerifyingPin(false)
    }
  }, [currentPin, onVerifyPin, t])

  const handleBackupPinChange = useCallback((value: string) => {
    setBackupPin(value)
    setBackupError('')
  }, [])

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

  const handleLogoutPinChange = useCallback((value: string) => {
    setLogoutPin(value)
    setLogoutError('')
  }, [])

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
        setRestoreProgress(`${i + 1}/${mints.length}: ${new URL(mintUrl).hostname}`)
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
    } catch (err) {
      console.error('[Settings] Restore error:', err)
      setRestoreResult({ success: false, message: t('settings.verificationError') })
    } finally {
      setIsRestoring(false)
      setRestoreProgress('')
    }
  }, [settings.mints, setBalance, t])

  const resetBackupModal = useCallback(() => {
    setShowBackupModal(false)
    setBackupPin('')
    setMnemonic('')
    setBackupError('')
  }, [])

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden z-[60]"
    >
      {/* Header */}
      <header className="flex items-center px-3 pt-4 relative z-50">
        <button onClick={onBack} aria-label={t('common.back')} className="p-2 rounded-full bg-white/60 shadow-sm hover:shadow-md transition-all hover:bg-background-card backdrop-blur-md">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-base font-bold tracking-tight ml-3">{t('settings.title')}</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-32">
        {/* Update Button */}
        {updateAvailable && (
          <button
            onClick={() => updateSW()}
            className="w-full bg-[#1d1d1f] text-white p-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
          >
            <Download className="w-4 h-4" />
            {t('settings.updateAvailable')}
          </button>
        )}

        {/* Profile Section */}
        <ProfileSection
          nostrPubkey={nostrPubkey}
          npubCopied={npubCopied}
          encodeNpub={encodeNpub}
          onCopyNpub={handleCopyNpub}
        />

        {/* Security Section */}
        <SecuritySection
          autoLockEnabled={autoLockEnabled}
          autoLockTimeout={autoLockTimeout}
          passkeySupported={passkeySupported}
          passkeyEnabled={passkeyEnabled}
          onAutoLockToggle={handleAutoLockToggle}
          onAutoLockTimeoutChange={handleAutoLockTimeoutChange}
          onPasskeyToggle={handlePasskeyToggle}
          onOpenPinChange={() => setShowPasswordModal(true)}
        />

        {/* Language Section */}
        <section>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-2 px-2">{t('settings.language')}</h3>
          <div className="bg-white/60 rounded-2xl overflow-hidden shadow-sm border border-white/50">
            <button
              onClick={() => setShowLanguageModal(true)}
              className="w-full p-3 flex items-center justify-between hover:bg-white/40 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-xl text-foreground">
                  <Globe className="w-4 h-4" />
                </div>
                <span className="font-bold text-xs">{t('settings.language')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-foreground-muted bg-background px-2 py-1 rounded-lg">
                  {SUPPORTED_LANGUAGES.find(l => l.code === currentLang)?.nativeName || 'English'}
                </span>
                <ChevronRight className="w-4 h-4 text-foreground-muted" />
              </div>
            </button>
          </div>
        </section>

        {/* Unit Display Section */}
        <section>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-2 px-2">{t('settings.unitDisplay')}</h3>
          <div className="bg-white/60 rounded-2xl overflow-hidden shadow-sm border border-white/50">
            <div className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-xl text-foreground">
                  <Coins className="w-4 h-4" />
                </div>
                <span className="font-bold text-xs">{t('settings.unitDisplay')}</span>
              </div>
              <div className="flex bg-background rounded-lg p-0.5">
                {(['bip177', 'sats'] as const).map((unit) => (
                  <button
                    key={unit}
                    onClick={() => saveSettings({ unitDisplay: unit })}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-xs font-bold transition-all',
                      (settings.unitDisplay ?? 'bip177') === unit
                        ? 'bg-primary text-white shadow-sm'
                        : 'text-foreground-muted hover:text-foreground',
                    )}
                  >
                    {unit === 'bip177' ? '₿' : 'sats'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Wallet Management Section */}
        <WalletManagementSection
          mintsCount={settings.mints.length}
          relaysCount={settings.relays.length}
          onOpenMints={() => setShowMintsModal(true)}
          onOpenRelays={() => setShowRelaysModal(true)}
          onOpenRestore={() => setShowRestoreModal(true)}
          onOpenBackup={() => setShowBackupModal(true)}
        />

        {/* Tools Section */}
        <section>
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-2 px-2">{t('settings.tools')}</h3>
          <div className="bg-white/60 rounded-2xl overflow-hidden shadow-sm border border-white/50">
            <button
              onClick={onTransfer}
              className="w-full p-3 flex items-center justify-between hover:bg-white/40 transition-colors text-left border-b border-white/30"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-xl text-foreground">
                  <ArrowLeftRight className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-xs">{t('actions.transfer')}</span>
                  <span className="text-[10px] text-foreground-muted">{t('settings.transferDescription')}</span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-foreground-muted" />
            </button>
            <button
              onClick={onAnalytics}
              className="w-full p-3 flex items-center justify-between hover:bg-white/40 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-xl text-foreground">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-xs">{t('actions.analytics')}</span>
                  <span className="text-[10px] text-foreground-muted">{t('settings.analyticsDescription')}</span>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-foreground-muted" />
            </button>
          </div>
        </section>

        {/* POS Management Section */}
        <POSProvisioningSection
          settings={settings}
          nostrPubkey={nostrPubkey}
          nostrPrivkey={nostrPrivkey}
          lightningAddress={settings.lightningAddress}
          isRegistering={isRegistering}
          onRegisterLightningAddress={handleRegisterLightningAddress}
          onOpenUsernameChange={onChangeUsername}
          onBackupMnemonic={onBackupMnemonic}
          onSaveSettings={saveSettings}
        />

        {/* Logout Section */}
        <section>
          <button
            onClick={() => setShowLogoutModal(true)}
            className="w-full bg-accent-danger/10 hover:bg-accent-danger/20 border border-accent-danger/20 text-accent-danger p-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            {t('settings.logout')}
          </button>
          <div className="text-center mt-4">
            <span className="text-[10px] font-bold text-foreground-muted/50 uppercase tracking-widest">{t('settings.version')}</span>
          </div>
        </section>
      </div>

      {/* PIN Change Modal */}
      <PinChangeModal
        isOpen={showPasswordModal}
        step={pinChangeStep}
        currentPin={currentPin}
        newPin={newPin}
        confirmPin={confirmPin}
        pinError={pinError}
        isVerifyingPin={isVerifyingPin}
        isChangingPin={isChangingPin}
        onCurrentPinChange={handleCurrentPinChange}
        onNewPinChange={handleNewPinChange}
        onConfirmPinChange={handleConfirmPinChange}
        onCurrentPinSubmit={handleCurrentPinSubmit}
        onPinChangeSubmit={handlePinChangeSubmit}
        onClose={resetPinChangeModal}
      />

      {/* Backup Modal */}
      <Modal isOpen={showBackupModal} onClose={resetBackupModal} title={t('settings.mnemonicBackup')}>
        {!mnemonic ? (
          <div className="py-3">
            <PinInput value={backupPin} onChange={handleBackupPinChange} label={t('settings.enterPinLabel')} error={backupError} />
            <Button variant="primary" size="lg" onClick={handleBackupMnemonic} loading={isLoadingBackup} disabled={backupPin.length !== 6} className="w-full mt-4">
              {t('common.confirm')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-accent-danger/10 border border-accent-danger/20 p-3 rounded-xl flex gap-2">
              <AlertTriangle className="w-5 h-5 text-accent-danger shrink-0" />
              <p className="text-[10px] text-accent-danger font-bold leading-relaxed">
                {t('settings.mnemonicWarning')}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {mnemonic.split(' ').map((word, i) => (
                <div key={i} className="flex items-center gap-2 bg-white/60 p-2 rounded-xl border border-white/50">
                  <span className="text-[10px] font-bold text-foreground-muted/50 w-4">{i + 1}</span>
                  <span className="text-xs font-bold text-foreground">{word}</span>
                </div>
              ))}
            </div>
            <Button variant="secondary" size="lg" onClick={resetBackupModal} className="w-full">
              {t('common.close')}
            </Button>
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
            <div className="w-14 h-14 rounded-full bg-accent-danger/10 flex items-center justify-center text-accent-danger">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <p className="text-xs text-foreground-muted">
              {t('settings.logoutWarning')}
            </p>
          </div>
          <PinInput value={logoutPin} onChange={handleLogoutPinChange} label={t('settings.enterPinLabel')} error={logoutError} />
          <div className="flex gap-2 mt-4">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => { setShowLogoutModal(false); setLogoutPin(''); setLogoutError('') }}
              className="flex-1"
            >
              {t('common.cancel')}
            </Button>
            <button
              onClick={handleLogout}
              disabled={logoutPin.length !== 6 || isLoggingOut}
              className={cn(
                'flex-1 p-2 rounded-xl font-bold transition-colors shadow-lg',
                logoutPin.length !== 6 || isLoggingOut
                  ? 'bg-accent-danger/50 text-white/50 cursor-not-allowed'
                  : 'bg-accent-danger text-white hover:bg-accent-danger-hover shadow-accent-danger/30'
              )}
            >
              {isLoggingOut ? t('common.processing') : t('settings.logout')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Passkey Registration Modal */}
      <Modal isOpen={showPasskeyModal} onClose={resetPasskeyModal} title={t('settings.passkeySetup')}>
        <div className="py-3">
          <p className="text-xs text-foreground-muted text-center mb-3">
            {t('settings.passkeyDescription')}
          </p>
          <PinInput value={passkeyPin} onChange={handlePasskeyPinChange} label={t('settings.enterPinLabel')} error={passkeyError} />
          <Button variant="primary" size="lg" onClick={handlePasskeyRegister} loading={isRegisteringPasskey} disabled={passkeyPin.length !== 6} className="w-full mt-4">
            {t('settings.register')}
          </Button>
        </div>
      </Modal>

      {/* Passkey Remove Modal */}
      <Modal isOpen={showPasskeyRemoveModal} onClose={resetPasskeyModal} title={t('settings.passkeyRemove')}>
        <div className="py-3">
          <p className="text-xs text-foreground-muted text-center mb-3">
            {t('settings.passkeyRemoveDescription')}
          </p>
          <PinInput value={passkeyPin} onChange={handlePasskeyPinChange} label={t('settings.enterPinLabel')} error={passkeyError} />
          <Button variant="destructive" size="lg" onClick={handlePasskeyRemove} loading={isRemovingPasskey} disabled={passkeyPin.length !== 6} className="w-full mt-4">
            {t('settings.remove')}
          </Button>
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
              <p className="text-xs text-foreground-muted">
                {t('settings.restoreDescription')}
              </p>
              <p className="text-xs text-foreground-muted">{t('settings.registeredMints', { count: settings.mints.length })}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="lg" onClick={() => setShowRestoreModal(false)} className="flex-1">
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" size="lg" onClick={handleRestoreTokens} className="flex-1">
                  {t('settings.startVerification')}
                </Button>
              </div>
            </>
          )}
          {isRestoring && (
            <div className="text-center py-6">
              <div className="relative mb-4 mx-auto w-16 h-16">
                <div
                  className="w-16 h-16 rounded-full border-4 border-primary/10 border-t-primary animate-spin"
                  style={{ animationDuration: '2s' }}
                />
                <div className="absolute inset-0 flex items-center justify-center">
                  <ShieldCheck className="w-6 h-6 text-foreground" />
                </div>
              </div>
              <p className="font-bold text-foreground">{t('settings.verifying')}</p>
              {restoreProgress && <p className="text-[10px] text-foreground-muted mt-2">{restoreProgress}</p>}
            </div>
          )}
          {restoreResult && (
            <div className="text-center py-3">
              <div className={cn(
                'w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-3',
                restoreResult.success ? 'bg-accent-primary/20 text-accent-primary' : 'bg-accent-danger/20 text-accent-danger'
              )}>
                {restoreResult.success ? <Check className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
              </div>
              <p className="font-bold text-foreground">{restoreResult.message}</p>
              <Button variant="primary" size="lg" onClick={() => { setShowRestoreModal(false); setRestoreResult(null) }} className="w-full mt-3">
                {t('common.confirm')}
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* Mints BottomSheet */}
      <MintsBottomSheet
        isOpen={showMintsModal}
        mints={settings.mints}
        balanceByMint={balanceByMint}
        selectedMint={selectedMint}
        mintToDelete={mintToDelete}
        getDisplayName={getDisplayName}
        getIconUrl={getIconUrl}
        getCachedStatus={getCachedStatus}
        onClose={() => setShowMintsModal(false)}
        onAddMint={() => { setShowMintsModal(false); onAddMint?.() }}
        onSelectMint={setSelectedMint}
        onCloseMintDetails={() => setSelectedMint(null)}
        onRemoveMint={handleRemoveMint}
        onConfirmRemoveMint={confirmRemoveMint}
        onCancelRemoveMint={() => setMintToDelete(null)}
      />

      {/* Relays BottomSheet */}
      <RelaysBottomSheet
        isOpen={showRelaysModal}
        relays={settings.relays}
        newRelayUrl={newRelayUrl}
        isValidatingRelay={isValidatingRelay}
        relayError={relayError}
        onClose={() => { setShowRelaysModal(false); setRelayError(''); setNewRelayUrl('') }}
        onNewRelayUrlChange={setNewRelayUrl}
        onRelayErrorClear={() => setRelayError('')}
        onAddRelay={handleAddRelay}
        onRemoveRelay={handleRemoveRelay}
      />

      {/* Language Selection Modal */}
      <BottomSheet
        isOpen={showLanguageModal}
        onClose={() => setShowLanguageModal(false)}
        title={t('settings.language')}
      >
        <div className="p-3 space-y-2">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => handleLanguageChange(lang.code)}
              className={cn(
                'w-full p-3 rounded-xl border flex items-center justify-between transition-all',
                currentLang === lang.code
                  ? 'bg-primary border-primary text-white'
                  : 'bg-white/60 border-white/50 text-foreground hover:bg-white/80'
              )}
            >
              <div className="flex items-center gap-3">
                <span className="font-bold text-sm">{lang.nativeName}</span>
                <span className="text-[10px] opacity-70">{lang.name}</span>
              </div>
              {currentLang === lang.code && <Check className="w-4 h-4" />}
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  )
}

export default SettingsScreen
