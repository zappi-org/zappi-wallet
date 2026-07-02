import { useState, useCallback, useEffect, useRef, type ClipboardEvent } from 'react'
import { AlertTriangle, Check, ClipboardPaste, Copy, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence } from 'motion/react'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { Modal, PinInput } from '../../components/common'
import { useAppStore } from '@/store'
import { satUnit } from '@/utils/format'
import { formatMintHost } from '@/utils/url'
import { ZAPPI_LINK_URL } from '@/core/constants'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { cn } from '@/ui/primitives/utils'
import { Button } from '@/ui/components/common/Button'
import { ENABLE_LIGHTNING_ADDRESS_SETTINGS } from '@/ui/config/feature-flags'

import { PinChangePage } from './pages/PinChangePage'
import { usePinChange } from './usePinChange'
import { SettingsMainList } from './SettingsMainList'
import { LanguageSettingPage } from './pages/LanguageSettingPage'
import { UnitDisplaySettingPage } from './pages/UnitDisplaySettingPage'
import { FiatSettingPage } from './pages/FiatSettingPage'
import {
  registerPasskey,
  removePasskey,
} from '@/ui/services/passkey'
import { AutoLockSettingPage } from './pages/AutoLockSettingPage'
import { POSSettingPage } from './pages/POSSettingPage'
import { PrivacySettingPage } from './pages/PrivacySettingPage'
import { NpubDetailPage } from './pages/NpubDetailPage'
import { LightningDetailPage } from './pages/LightningDetailPage'
import { ProfileCategoryPage } from './pages/ProfileCategoryPage'
import { PreferencesCategoryPage } from './pages/PreferencesCategoryPage'
import { SecurityCategoryPage } from './pages/SecurityCategoryPage'
import { WalletCategoryPage } from './pages/WalletCategoryPage'
import { SupportPage } from './pages/SupportPage'

const RECOVERY_PHRASE_WORD_COUNT = 12

function normalizeRecoveryPhraseWords(value: string): string[] {
  return value.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export type SettingsPage =
  | 'category-profile' | 'category-preferences' | 'category-security' | 'category-wallet'
  | 'language' | 'unitDisplay' | 'fiat' | 'autoLock' | 'pos' | 'privacy' | 'npubDetail' | 'lightningDetail' | 'support'

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
  onSubPageChange?: (hasSubPage: boolean) => void
}

export function SettingsScreen({
  onBack: _onBack,
  onChangePassword,
  onBackupMnemonic,
  onLogout,
  onVerifyPin,
  onSaveSettings,
  onMintManagement,
  onRelayManagement,
  onChangeUsername,
  onAnalytics,
  onSubPageChange,
}: SettingsScreenProps) {
  const { t } = useTranslation()
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const addToast = useAppStore((state) => state.addToast)
  const nostrPubkey = useAppStore((state) => state.nostrPubkey)
  const nostrPrivkey = useAppStore((state) => state.nostrPrivkey)
  const p2pkPubkey = useAppStore((state) => state.p2pkPubkey)
  const registry = useServiceRegistry()
  const setBalance = useAppStore((state) => state.setBalance)

  // Two-layer navigation: category (z-65) + detail (z-66)
  type CategoryPage = 'category-profile' | 'category-preferences' | 'category-security' | 'category-wallet'
  const [categoryPage, setCategoryPage] = useState<CategoryPage | null>(null)
  const [detailPage, setDetailPage] = useState<Exclude<SettingsPage, CategoryPage> | null>(null)

  // Unified setter for SettingsMainList and category pages
  const navigateTo = useCallback((page: SettingsPage) => {
    if (page.startsWith('category-')) {
      setCategoryPage(page as CategoryPage)
    } else {
      setDetailPage(page as Exclude<SettingsPage, CategoryPage>)
    }
  }, [])

  // Derived: any sub-page is open
  const hasSubPage = categoryPage !== null || detailPage !== null

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
  const [restoreMode, setRestoreMode] = useState<'current' | 'external'>('current')
  const [isFullResyncing, setIsFullResyncing] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreProgress, setRestoreProgress] = useState('')
  const [restoreResult, setRestoreResult] = useState<{ success: boolean; message: string } | null>(null)
  const [externalMnemonicWords, setExternalMnemonicWords] = useState<string[]>(
    () => Array(RECOVERY_PHRASE_WORD_COUNT).fill('')
  )
  const externalMnemonicComplete = externalMnemonicWords.every((word) => word.trim())

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

  // Notify parent when sub-page opens/closes (for bottom nav animation)
  useEffect(() => {
    onSubPageChange?.(hasSubPage || pinChange.isOpen)
  }, [hasSubPage, pinChange.isOpen, onSubPageChange])

  // 서브페이지 진입/이탈 시 history 연동 (iOS 엣지 스와이프 뒤로가기 대응)
  const prevHasSubPageRef = useRef(false)
  useEffect(() => {
    const prev = prevHasSubPageRef.current
    prevHasSubPageRef.current = hasSubPage

    if (hasSubPage && !prev) {
      window.history.pushState({ screen: 'settings' }, '')
    }
  }, [hasSubPage])

  const detailPageRef = useRef(detailPage)
  const categoryPageRef = useRef(categoryPage)
  useEffect(() => { detailPageRef.current = detailPage }, [detailPage])
  useEffect(() => { categoryPageRef.current = categoryPage }, [categoryPage])

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (detailPageRef.current !== null) {
        e.stopImmediatePropagation()
        setDetailPage(null)
        return
      }
      if (categoryPageRef.current !== null) {
        e.stopImmediatePropagation()
        setCategoryPage(null)
      }
    }
    window.addEventListener('popstate', handlePopState, true)
    return () => window.removeEventListener('popstate', handlePopState, true)
  }, [])

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

  // Auto-check existing address on mount
  useEffect(() => {
    if (!ENABLE_LIGHTNING_ADDRESS_SETTINGS) return
    if (!nostrPubkey || settings.lightningAddress) return
    registry.username.getAddress(nostrPubkey).then((result) => {
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
    if (!ENABLE_LIGHTNING_ADDRESS_SETTINGS) return
    if (!nostrPrivkey || !p2pkPubkey) return
    setIsRegistering(true)
    try {
      await registry.profile.publishNutZapInfo(
        nostrPubkey!,
        settings.mints,
        p2pkPubkey,
        settings.relays,
      )
      const result = await registry.username.registerAddress(nostrPrivkey)
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
  }, [nostrPrivkey, nostrPubkey, p2pkPubkey, settings.mints, settings.relays, registry, saveSettings, addToast, t])

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

  const resetRestoreModal = useCallback(() => {
    if (isRestoring) return
    setShowRestoreModal(false)
    setRestoreMode('current')
    setRestoreResult(null)
    setRestoreProgress('')
    setExternalMnemonicWords(Array(RECOVERY_PHRASE_WORD_COUNT).fill(''))
  }, [isRestoring])

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

  const applyExternalMnemonicText = useCallback((value: string) => {
    const words = normalizeRecoveryPhraseWords(value)
    if (words.length === 0) return false
    if (words.length !== RECOVERY_PHRASE_WORD_COUNT) {
      addToast({ type: 'error', message: t('settings.externalMnemonicWordCountRequired') })
      return false
    }

    setExternalMnemonicWords(
      Array.from({ length: RECOVERY_PHRASE_WORD_COUNT }, (_, index) => words[index] ?? '')
    )
    return true
  }, [addToast, t])

  const handleExternalMnemonicWordChange = useCallback(
    (index: number, value: string) => {
      const pastedWords = normalizeRecoveryPhraseWords(value)
      if (pastedWords.length > 1) {
        applyExternalMnemonicText(value)
        return
      }

      const word = value.trim().toLowerCase()
      setExternalMnemonicWords((current) => {
        const next = [...current]
        next[index] = word
        return next
      })
    },
    [applyExternalMnemonicText]
  )

  const handleExternalMnemonicPaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>) => {
      const text = event.clipboardData.getData('text')
      if (normalizeRecoveryPhraseWords(text).length <= 1) return
      event.preventDefault()
      applyExternalMnemonicText(text)
    },
    [applyExternalMnemonicText]
  )

  const handlePasteExternalMnemonic = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      applyExternalMnemonicText(text)
    } catch {
      addToast({ type: 'error', message: t('errors.clipboardError') })
    }
  }, [addToast, applyExternalMnemonicText, t])

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
      const beforeModules = await registry.balance.getByModule()
      const beforeTotal = beforeModules.reduce((sum, m) => sum + m.accounts.reduce((s, a) => s + Number(a.amount.value), 0), 0)

      setRestoreProgress(t('settings.recoveringLightning'))
      try {
        // 사용자 명시 복구 버튼 — gate 미적용 (설계 §6.2/§6.3): Coco sweep
        // 전종(B1/B2 포함) + 표적 구제 + 로컬 정합. 연타는 in-flight 공유,
        // 진행 중 Coco sweep은 개별 skip [N7].
        const report = await registry.recoveryScheduler.runFullNetworkRecovery()
        if (report.recovered > 0) console.log('[Settings] Recovered:', report.recovered)
      } catch (err) {
        console.warn('[Settings] Recovery failed:', err)
      }

      for (let i = 0; i < mints.length; i++) {
        const mintUrl = mints[i]
        setRestoreProgress(`${i + 1}/${mints.length}: ${formatMintHost(mintUrl)}`)
        const reports = await registry.payment.recoverAccounts({ accountIds: [mintUrl] })
        const failed = reports.find((report) => !report.success)
        if (failed) {
          console.warn('[Settings] Failed to restore from:', mintUrl, failed.error)
        }
      }

      const afterModules = await registry.balance.getByModule()
      const afterTotal = afterModules.reduce((sum, m) => sum + m.accounts.reduce((s, a) => s + Number(a.amount.value), 0), 0)

      const recovered = afterTotal - beforeTotal
      if (recovered > 0) {
        setRestoreResult({ success: true, message: t('settings.recoveredAmount', { amount: recovered.toLocaleString(), unit: satUnit() }) })
      } else {
        setRestoreResult({ success: true, message: t('settings.noMissingBalance') })
      }
      const byMint: Record<string, number> = {}
      for (const m of afterModules) {
        for (const a of m.accounts) {
          byMint[a.id] = Number(a.amount.value)
        }
      }
      setBalance({ total: afterTotal, byMint })
    } catch {
      setRestoreResult({ success: false, message: t('settings.verificationError') })
    } finally {
      setIsRestoring(false)
      setRestoreProgress('')
    }
  }, [settings.mints, setBalance, t, registry.balance, registry.payment, registry.recoveryScheduler])

  const handleRestoreExternalMnemonic = useCallback(async () => {
    const mints = settings.mints
    if (!externalMnemonicComplete) {
      setRestoreResult({ success: false, message: t('settings.externalMnemonicRequired') })
      return
    }
    const mnemonicToRestore = externalMnemonicWords
      .map((word) => word.trim().toLowerCase())
      .join(' ')

    setIsRestoring(true)
    setRestoreResult(null)
    try {
      const report = await registry.externalWalletRecovery.recoverFromMnemonic({
        mnemonic: mnemonicToRestore,
        currentMintUrls: mints,
        onProgress: ({ mintUrl, index, total }) => {
          setRestoreProgress(`${index}/${total}: ${formatMintHost(mintUrl)}`)
        },
      })

      const afterModules = await registry.balance.getByModule()
      const afterTotal = afterModules.reduce((sum, m) => sum + m.accounts.reduce((s, a) => s + Number(a.amount.value), 0), 0)
      const byMint: Record<string, number> = {}
      for (const m of afterModules) {
        for (const a of m.accounts) {
          byMint[a.id] = Number(a.amount.value)
        }
      }
      setBalance({ total: afterTotal, byMint })

      if (report.recovered > 0) {
        setRestoreResult({ success: true, message: t('settings.recoveredAmount', { amount: report.recovered.toLocaleString(), unit: satUnit() }) })
      } else if (report.failed > 0 && report.scannedMints === 0) {
        setRestoreResult({ success: false, message: t('settings.verificationError') })
      } else {
        setRestoreResult({ success: true, message: t('settings.noRecoverableEcash') })
      }
    } catch (error) {
      const message = error instanceof Error && error.message === 'Invalid mnemonic'
        ? t('onboarding.invalidMnemonic')
        : t('settings.verificationError')
      setRestoreResult({ success: false, message })
    } finally {
      setIsRestoring(false)
      setRestoreProgress('')
    }
  }, [
    externalMnemonicComplete,
    externalMnemonicWords,
    settings.mints,
    registry.balance,
    registry.externalWalletRecovery,
    setBalance,
    t,
  ])

  // Render category page (z-65)
  const renderCategoryPage = () => {
    switch (categoryPage) {
      case 'category-profile':
        return (
          <ProfileCategoryPage
            onBack={() => setCategoryPage(null)}
            onNavigate={navigateTo}
            onRegisterLightningAddress={handleRegisterLightningAddress}
            isRegistering={isRegistering}
            onAnalytics={onAnalytics}
          />
        )
      case 'category-preferences':
        return (
          <PreferencesCategoryPage
            onBack={() => setCategoryPage(null)}
            onNavigate={navigateTo}
          />
        )
      case 'category-security':
        return (
          <SecurityCategoryPage
            onBack={() => setCategoryPage(null)}
            onNavigate={navigateTo}
            onFaceIdToggle={handleFaceIdToggle}
            onOpenPinChange={pinChange.open}
          />
        )
      case 'category-wallet':
        return (
          <WalletCategoryPage
            onBack={() => setCategoryPage(null)}
            onMintManagement={onMintManagement}
            onRelayManagement={onRelayManagement}
            onOpenCurrentWalletRecovery={() => {
              setRestoreMode('current')
              setShowRestoreModal(true)
            }}
            onOpenExternalMnemonicRecovery={() => {
              setRestoreMode('external')
              setRestoreResult(null)
              setRestoreProgress('')
              setExternalMnemonicWords(Array(RECOVERY_PHRASE_WORD_COUNT).fill(''))
              setShowRestoreModal(true)
            }}
            onFullResync={handleFullResync}
            onOpenBackup={() => setShowBackupModal(true)}
          />
        )
      default:
        return null
    }
  }

  // 릴레이 전체 재동기화 — 재설치급 full replay (설계 §10 B5 수동 트리거).
  // deep-resync 창도 함께 리셋된다. 중복 실행은 isFullResyncing으로 가드.
  const handleFullResync = useCallback(async () => {
    if (isFullResyncing) return
    if (!nostrPubkey || !nostrPrivkey) return
    if (!window.confirm(t('settings.fullResyncConfirm'))) return

    setIsFullResyncing(true)
    try {
      const result = await registry.recovery.resyncFull({
        privateKey: nostrPrivkey,
        publicKey: nostrPubkey,
        relays: settings.relays,
      })
      // 부분 실패를 성공으로 위장하지 않는다 (리뷰 #3) — 오류 시 deep 창도 리셋 안 됨
      if (result.errors.length > 0) {
        console.warn('[Settings] Full resync completed with errors:', result.errors)
        addToast({ type: 'error', message: t('settings.fullResyncFailed'), duration: 4000 })
      } else {
        addToast({ type: 'success', message: t('settings.fullResyncDone'), duration: 4000 })
      }
    } catch (error) {
      console.error('[Settings] Full resync failed:', error)
      addToast({ type: 'error', message: t('settings.fullResyncFailed'), duration: 4000 })
    } finally {
      setIsFullResyncing(false)
    }
  }, [isFullResyncing, nostrPubkey, nostrPrivkey, registry, settings.relays, addToast, t])

  // Render detail page (z-66, on top of category)
  const renderDetailPage = () => {
    const closeDetail = () => setDetailPage(null)
    switch (detailPage) {
      case 'language':
        return <LanguageSettingPage onBack={closeDetail} />
      case 'unitDisplay':
        return <UnitDisplaySettingPage onBack={closeDetail} saveSettings={saveSettings} />
      case 'fiat':
        return <FiatSettingPage onBack={closeDetail} saveSettings={saveSettings} />
      case 'autoLock':
        return <AutoLockSettingPage onBack={closeDetail} saveSettings={saveSettings} />
      case 'pos':
        return (
          <POSSettingPage
            onBack={closeDetail}
            settings={settings}
            nostrPubkey={nostrPubkey}
            nostrPrivkey={nostrPrivkey}
            onBackupMnemonic={onBackupMnemonic}
            onSaveSettings={saveSettings}
          />
        )
      case 'privacy':
        return <PrivacySettingPage onBack={closeDetail} saveSettings={saveSettings} />
      case 'npubDetail':
        return <NpubDetailPage onBack={closeDetail} />
      case 'lightningDetail':
        if (!ENABLE_LIGHTNING_ADDRESS_SETTINGS) return null
        return (
          <LightningDetailPage
            onBack={closeDetail}
            onChangeUsername={onChangeUsername}
          />
        )
      case 'support':
        return <SupportPage onBack={closeDetail} />
      default:
        return null
    }
  }

  return (
    <div className="h-full bg-background text-foreground flex flex-col pt-safe overflow-hidden">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0 z-50">
        <div className="w-10" />
        <h2 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">{t('settings.title')}</h2>
        <div className="w-10" />
      </header>

      {/* Main list */}
      <SettingsMainList
        onNavigate={navigateTo}
        onOpenLogout={() => setShowLogoutModal(true)}
      />

      {/* Category page overlay (z-65) */}
      <AnimatePresence mode="wait">
        {categoryPage && (
          <PageTransition key={categoryPage} variant="page" className="absolute inset-0 z-[65]">
            {renderCategoryPage()}
          </PageTransition>
        )}
      </AnimatePresence>

      {/* Detail page overlay (z-66, on top of category) */}
      <AnimatePresence mode="wait">
        {detailPage && (
          <PageTransition key={detailPage} variant="page" className="absolute inset-0 z-[66]">
            {renderDetailPage()}
          </PageTransition>
        )}
      </AnimatePresence>

      {/* PIN Change — Full-screen page */}
      <AnimatePresence mode="wait">
        {pinChange.isOpen && (
          <PageTransition key="pin-change" variant="page" className="absolute inset-0 z-[67]">
            <PinChangePage pinChange={pinChange} />
          </PageTransition>
        )}
      </AnimatePresence>

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
                        <span className="text-label font-medium tabular-nums text-foreground-subtle w-5 text-right shrink-0">{i + 1}</span>
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
            <Button variant="brand" size="lg" onClick={resetBackupModal} className="w-full">
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
            <div className="w-12 h-12 rounded-xl bg-accent-danger/[0.08] flex items-center justify-center text-accent-danger">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <p className="text-body font-semibold text-accent-danger">
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
            submitVariant="destructive"
          />
        </div>
      </Modal>

      {/* Token Restore Modal */}
      <Modal
        isOpen={showRestoreModal}
        onClose={resetRestoreModal}
        title={restoreMode === 'current' ? t('settings.currentWalletRecovery') : t('settings.externalMnemonicRecovery')}
      >
        <div className="space-y-3">
          {!isRestoring && !restoreResult && (
            <>
              {restoreMode === 'current' && (
                <>
                  <p className="text-body text-foreground-muted">
                    {t('settings.restoreDescription')}
                  </p>
                  <p className="text-caption text-foreground-muted">{t('settings.registeredMints', { count: settings.mints.length })}</p>
                  <Button variant="brand" size="lg" onClick={handleRestoreTokens} className="w-full">
                    {t('settings.startVerification')}
                  </Button>
                </>
              )}

              {restoreMode === 'external' && (
                <>
                  <p className="text-body text-foreground-muted">
                    {t('settings.externalMnemonicRecoveryWarning')}
                  </p>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handlePasteExternalMnemonic}
                      className="flex h-8 items-center gap-1.5 rounded-full px-3 text-caption font-semibold text-foreground-muted transition-colors active:bg-background-card active:text-foreground"
                    >
                      <ClipboardPaste className="h-4 w-4" />
                      {t('common.paste')}
                    </button>
                  </div>
                  <div className="bg-background-card rounded-xl p-4">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0">
                      {externalMnemonicWords.map((word, index) => (
                        <div
                          key={index}
                          className={`flex min-w-0 items-center gap-2 py-2.5 ${
                            index < RECOVERY_PHRASE_WORD_COUNT - 2
                              ? 'border-b border-border'
                              : ''
                          }`}
                        >
                          <span className="text-label font-medium tabular-nums text-foreground-subtle w-5 text-right shrink-0">
                            {index + 1}
                          </span>
                          <input
                            value={word}
                            onChange={(event) => handleExternalMnemonicWordChange(index, event.target.value)}
                            onPaste={handleExternalMnemonicPaste}
                            aria-label={`${index + 1}. ${t('settings.externalMnemonicPlaceholder')}`}
                            className="min-w-0 flex-1 bg-transparent text-body font-medium text-foreground focus:outline-none"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <p className="text-caption text-foreground-muted">{t('settings.registeredMints', { count: settings.mints.length })}</p>
                  <Button
                    variant="brand"
                    size="lg"
                    onClick={handleRestoreExternalMnemonic}
                    disabled={!externalMnemonicComplete}
                    className="w-full"
                  >
                    {t('settings.startRecovery')}
                  </Button>
                </>
              )}
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
              {restoreProgress && <p className="text-overline font-medium text-foreground-muted mt-2">{restoreProgress}</p>}
            </div>
          )}
          {restoreResult && (
            <div className="text-center py-3">
              <div className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3',
                restoreResult.success ? 'bg-accent-primary/10 text-accent-primary' : 'bg-accent-danger/10 text-accent-danger'
              )}>
                {restoreResult.success ? <Check className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
              </div>
              <p className="font-semibold text-foreground">{restoreResult.message}</p>
              <Button variant="brand" size="lg" onClick={resetRestoreModal} className="w-full mt-3">
                {t('common.confirm')}
              </Button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

export default SettingsScreen
