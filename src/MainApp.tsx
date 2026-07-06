import { AppLifecycleWatcher } from '@/composition/app-lifecycle.watcher'
import { createBootstrap, type BootstrapResult, type RouteContext, type RouteExecutionResult, type RouteSelection } from '@/composition/bootstrap'
import { resolveIncomingReview } from '@/composition/incoming-review'
import { createPreUnlockServices } from '@/composition/pre-unlock'
import { wipeAccountData } from '@/composition/logout'
import { LIMITS } from '@/core/constants'
import { sat, toNumber } from '@/core/domain/amount'
import { InsufficientBalanceError } from '@/core/errors/payment.errors'
import { ServiceProvider } from '@/ui/hooks/service-context'
import { useAppNavigation } from '@/ui/hooks/use-app-navigation'
import type { Screen } from '@/ui/hooks/use-app-navigation'
import { useAutoLock } from '@/ui/hooks/use-auto-lock'
import { useCrossTabSync } from '@/ui/hooks/use-cross-tab-sync'
import { useGlobalTokenClaimToast } from '@/ui/hooks/use-global-token-claim-toast'
import { useMintHandlers } from '@/ui/hooks/use-mint-handlers'

import { useReceiveHandlers } from '@/ui/hooks/use-receive-handlers'
import { useSecurityHandlers } from '@/ui/hooks/use-security-handlers'
import { useSupportNotifications } from '@/ui/hooks/use-support-notifications'
import { useSwapHandlers } from '@/ui/hooks/use-swap-handlers'
import { useTransactions } from '@/ui/hooks/use-transactions'
import { isNostrDirectAddress } from '@/core/domain/nostr-address'
import { translateError } from '@/ui/utils/error-i18n'
import { broadcastSync } from '@/utils/cross-tab-sync'
// useMintHealth removed — mint health checks done via serviceRegistry directly
import { useAppStore } from '@/store'
import { useNetwork } from '@/ui/hooks/use-network'
import { useWallet } from '@/ui/hooks/use-wallet'
import { setMintNameResolver, toErrorMessage } from '@/ui/utils/error-message'
import { isSameMintUrl } from '@/utils/url'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// Tier 1: Always loaded (critical path for authenticated users)
import { LoadingFallback } from '@/ui/components/common/LoadingFallback'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { MainTabToolbar, TokenTabToolbar } from '@/ui/components/layout/TabToolbar'
import { HomeScreen } from '@/ui/screens/Home/HomeScreen'
import { LockScreen } from '@/ui/screens/Lock/LockScreen'
import { EasterEggScreen } from '@/ui/screens/Token/EasterEggScreen'
import { TokenDetailScreen } from '@/ui/screens/Token/TokenDetailScreen'
import { TokenScreen } from '@/ui/screens/Token/TokenScreen'
import type { TokenDetailData } from '@/ui/screens/Token/types'
import {
  BanknotesIcon as BanknotesIconOutline,
  Cog6ToothIcon as Cog6ToothIconOutline,
  IdentificationIcon as IdentificationIconOutline,
  WalletIcon as WalletIconOutline,
} from '@heroicons/react/24/outline'
import {
  BanknotesIcon as BanknotesIconSolid,
  Cog6ToothIcon as Cog6ToothIconSolid,
  IdentificationIcon as IdentificationIconSolid,
  WalletIcon as WalletIconSolid,
} from '@heroicons/react/24/solid'

// Tier 2: Lazy loaded (frequently used)
const SettingsScreen = lazy(() => import('@/ui/screens/Settings/SettingsScreen'))
const ContactsScreen = lazy(() => import('@/ui/screens/Contacts/ContactsScreen'))
const HistoryScreen = lazy(() => import('@/ui/screens/History/HistoryScreen'))
const TransferScreen = lazy(() => import('@/ui/screens/Transfer/TransferScreen'))
const NotificationsScreen = lazy(() => import('@/ui/screens/Notifications/NotificationsScreen'))
const AnalyticsScreen = lazy(() => import('@/ui/screens/Analytics/AnalyticsScreen'))

// Tier 3: Lazy loaded (less frequently used)
const AddMintScreen = lazy(() => import('@/ui/screens/AddMint/AddMintScreen'))
const AmountActionScreen = lazy(() => import('@/ui/screens/AmountAction/AmountActionScreen'))
const UsernameChangeScreen = lazy(() => import('@/ui/screens/Settings/UsernameChangeScreen'))
const TransactionDetailScreen = lazy(() => import('@/ui/screens/TransactionDetail/TransactionDetailScreen'))
const MintDetailScreen = lazy(() => import('@/ui/screens/MintDetail/MintDetailScreen').then(m => ({ default: m.MintDetailScreen })))
const MintManagementScreen = lazy(() => import('@/ui/screens/Settings/MintManagementScreen'))
const RelayManagementScreen = lazy(() => import('@/ui/screens/Settings/RelayManagementScreen'))

// Unified Send/Receive flows
import type { ValidatedData } from '@/core/domain/input-types'
import type { MintInfo } from '@/core/types'
import { ToastContainer } from '@/ui/components'
import { ReceiveFlow } from '@/ui/screens/Receive/ReceiveFlow'
import { SendFlow } from '@/ui/screens/Send/SendFlow'
import { TokenCreateFlow } from '@/ui/screens/TokenCreate/TokenCreateFlow'
import { TokenRegisterFlow } from '@/ui/screens/TokenRegister/TokenRegisterFlow'
import { routeValidatedInput } from '@/ui/utils/input-router'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { formatNpubShort } from '@/ui/screens/Send/sendDisplayHelpers'

// Services (composition 경유만)
import { createSecurityService } from '@/composition/security'
import type { Transaction } from '@/core/domain/transaction'
import type { PendingIncomingReview } from '@/core/types'
import { removePasskey } from '@/ui/services/passkey'
import { formatSats } from '@/utils/format'


// Register mint name resolver for error messages
setMintNameResolver((mintUrl) => {
  const state = useAppStore.getState()
  return state.settings.mintAliases?.[mintUrl] || null
})

export default function MainApp() {
  const { t } = useTranslation()
  // Store state
  const isLocked = useAppStore((state) => state.isLocked)
  const isInitializing = useAppStore((state) => state.isInitializing)
  const toasts = useAppStore((state) => state.toasts)
  const settings = useAppStore((state) => state.settings)
  const nostrPubkey = useAppStore((state) => state.nostrPubkey)
  const nostrPrivkey = useAppStore((state) => state.nostrPrivkey)
  const pendingIncomingReviews = useAppStore((state) => state.pendingIncomingReviews)
  const supportUnreadCount = useAppStore((state) => state.supportUnreadCount)

  // Store actions
  const setLocked = useAppStore((state) => state.setLocked)
  const setInitializing = useAppStore((state) => state.setInitializing)
  const addToast = useAppStore((state) => state.addToast)
  const removeToast = useAppStore((state) => state.removeToast)

  const setFailedIncomingsCount = useAppStore((state) => state.setFailedIncomingsCount)
  const setNostrKeyPair = useAppStore((state) => state.setNostrKeyPair)
  const setP2pkPubkey = useAppStore((state) => state.setP2pkPubkey)
  const setSettings = useAppStore((state) => state.setSettings)

  // Service Registry (Phase 5: bootstrap 후 생성, unlock 전에는 null)
  const [serviceRegistry, setServiceRegistry] = useState<BootstrapResult | null>(null)

  // Hooks
  const { refreshBalance, balance } = useWallet()
  const { isOnline } = useNetwork()
  const [isRecovering, setIsRecovering] = useState(false)

  useCrossTabSync()
  useGlobalTokenClaimToast(serviceRegistry)
  useSupportNotifications(serviceRegistry)

  // Navigation state/logic (screen 전환, 탭 파생, 뒤로가기, History API) — Phase 4a 추출
  const {
    currentScreen,
    previousScreen,
    setCurrentScreen,
    setPreviousScreen,
    activeTab,
    isTabScreen,
    setHasSettingsSubPage,
    handleTabSelect,
    handleBack,
  } = useAppNavigation()

  // Bottom nav items
  const navItems = useMemo(() => [
    {
      id: 'wallet',
      label: t('nav.wallet'),
      icon: <WalletIconOutline className="w-[20px] h-[20px]" />,
      activeIcon: <WalletIconSolid className="w-[20px] h-[20px]" />,
    },
    {
      id: 'token',
      label: t('nav.token'),
      icon: <BanknotesIconOutline className="w-[20px] h-[20px]" />,
      activeIcon: <BanknotesIconSolid className="w-[20px] h-[20px]" />,
    },
    {
      id: 'contacts',
      label: t('nav.contacts'),
      icon: <IdentificationIconOutline className="w-[20px] h-[20px]" />,
      activeIcon: <IdentificationIconSolid className="w-[20px] h-[20px]" />,
    },
    {
      id: 'settings',
      label: t('nav.settings'),
      icon: <Cog6ToothIconOutline className="w-[20px] h-[20px]" />,
      activeIcon: <Cog6ToothIconSolid className="w-[20px] h-[20px]" />,
      badge: supportUnreadCount,
    },
  ], [t, supportUnreadCount])

  // Shared scroll container ref for Token tab (TokenScreen + TokenTabToolbar)
  const tokenScrollRef = useRef<HTMLDivElement>(null)

  // MintDetail screen state
  const [selectedMint, setSelectedMint] = useState<MintInfo | null>(null)
  const [selectedMintIndex, setSelectedMintIndex] = useState(0)

  // Scanned amount state (for AmountActionScreen)
  const [scannedAmount, setScannedAmount] = useState<number>(0)

  // Validated scan data state (for unified payment screens)
  const [validatedScanData, setValidatedScanData] = useState<ValidatedData | null>(null)
  const [activeIncomingReview, setActiveIncomingReview] = useState<PendingIncomingReview | null>(null)

  // Initial token string for TokenRegisterFlow (set by universal router)
  const [initialRegisterToken, setInitialRegisterToken] = useState<string>('')

  // Active mint from HomeScreen carousel
  const [activeMintUrl, setActiveMintUrl] = useState<string | null>(null)

  // History screen initial mint filter
  const [historyInitialMintUrls, setHistoryInitialMintUrls] = useState<string[] | undefined>(undefined)

  // Contact info for send flow (from address book)
  const [contactInfo, setContactInfo] = useState<{ address: string; displayName: string } | null>(null)

  // Home screen scanner (camera shortcut → QrScannerModal)
  const [showHomeScanner, setShowHomeScanner] = useState(false)
  // NIP-19 mint selection (set when camera scan resolves to needs-mint-selection)
  const [npubMintSelection, setNpubMintSelection] = useState<{
    validatedData: ValidatedData
    rawAddress: string
    commonMintUrls: string[]
  } | null>(null)

  // Transaction detail state
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)

  // Token detail state
  const [selectedTokenDetail, setSelectedTokenDetail] = useState<TokenDetailData | null>(null)

  // Pre-unlock services (unlock 전 settings/tx 로드에 필요, composition 경유)
  const [preUnlock] = useState(() => ({
    security: createSecurityService(),
    ...createPreUnlockServices(),
  }))

  // 거래 내역 + 원자적 잔액/거래 갱신 — Phase 4b 추출 (MAJOR-14: refreshAll 원자성 계약은 훅이 보존)
  const { transactions, setTransactions, refreshAll } = useTransactions({
    serviceRegistry,
    fallbackRefreshBalance: refreshBalance,
    txRepo: preUnlock.txRepo,
  })

  /** 잔액/거래 갱신 + recovery 병렬 실행 (toast/refresh는 EventBus bridge가 처리) */
  const refreshAndRecover = useCallback(async () => {
    if (!serviceRegistry) return
    await Promise.all([
      refreshAll(),
      serviceRegistry.payment.recoverAll().catch((e) => {
        console.error('[Recovery] Failed to recover pending operations:', e)
      }),
    ])
  }, [serviceRegistry, refreshAll])

  /** Manual pull-to-refresh handler */
  const handleManualRefresh = useCallback(async () => {
    if (!serviceRegistry) return
    await refreshAndRecover()
    serviceRegistry.mintHealth.checkAllMints(settings.mints).catch(() => { })
    serviceRegistry.exchangeRate.refreshIfStale().catch(() => { })
  }, [serviceRegistry, refreshAndRecover, settings.mints])

  /** Home camera shortcut — pre-validate and skip the destination step.
   *  Validated sendable input (bolt11, lightning-address, lnurl) goes straight
   *  to SendFlow's confirm/amount step. NIP-19 (npub/nprofile) reuses the
   *  same resolve → mint-select flow as ContactsScreen so the destination
   *  step is skipped. Falls back to the destination step if the service
   *  registry isn't ready. */
  const handleHomeScanResult = useCallback(async (raw: string) => {
    setShowHomeScanner(false)
    setValidatedScanData(null)
    setScannedAmount(0)

    // Inject default (primary) mint as the source context — prefer the active
    // mint (if it has balance), else first mint with balance, else first
    // configured mint. Matches TokenCreateFlow's default selection rule.
    let defaultMint: string | null = null
    if (activeMintUrl && (balance.byMint[activeMintUrl] ?? 0) > 0) {
      defaultMint = activeMintUrl
    } else {
      const withBalance = settings.mints.find((url) => (balance.byMint[url] ?? 0) > 0)
      if (withBalance) defaultMint = withBalance
      else if (settings.mints.length > 0) defaultMint = settings.mints[0]
      else if (activeMintUrl) defaultMint = activeMintUrl
    }
    setActiveMintUrl(defaultMint)

    // Registry not ready yet — fall back to the destination step. SendInputStep
    // will validate + auto-advance once ServiceProvider is mounted.
    if (!serviceRegistry) {
      setContactInfo({ address: raw, displayName: '' })
      setPreviousScreen(currentScreen)
      setCurrentScreen('send')
      return
    }

    const { inputParser, nostrDirectPayment } = serviceRegistry

    // NIP-19 (npub / nprofile) — handle BEFORE the unknown check, because
    // detectAndClassify doesn't classify raw npubs (returns 'unknown').
    // Resolve via nostrDirectPayment (same flow as ContactsScreen).
    // 'ready' → navigate to send with the resolved mint;
    // 'needs-mint-selection' → show a mint sheet, then navigate.
    if (isNostrDirectAddress(raw)) {
      const resolution = await nostrDirectPayment.resolve({
        address: raw,
        ownMintUrls: settings.mints,
        selectedMintUrl: defaultMint,
      })

      if (resolution.status === 'ready') {
        setActiveMintUrl(resolution.selectedMintUrl)
        setValidatedScanData(resolution.validatedData)
        setScannedAmount(0)
        setContactInfo({ address: '', displayName: formatNpubShort(raw) })
        setPreviousScreen(currentScreen)
        setCurrentScreen('send')
        return
      }

      if (resolution.status === 'needs-mint-selection') {
        setNpubMintSelection({
          validatedData: resolution.validatedData,
          rawAddress: raw,
          commonMintUrls: resolution.commonMintUrls,
        })
        return
      }

      const message = resolution.status === 'no-common-mint'
        ? t('send.destination.noCommonMint')
        : resolution.status === 'no-relay'
          ? t('send.destination.relayNotFound')
          : t('send.destination.ecashInfoNotFound')
      addToast({ type: 'error', message, duration: 3000 })
      return
    }

    // Quick classification — short-circuit on unknown.
    const detected = inputParser.detectAndClassify(raw)
    if (detected.type === 'unknown') {
      addToast({ type: 'error', message: t('scanner.unrecognizedFormat'), duration: 3000 })
      return
    }

    // Pre-validate so SendFlow can skip its destination step.
    let validated: ValidatedData
    try {
      validated = await inputParser.validateAsync(detected)
    } catch {
      addToast({ type: 'error', message: t('scanner.unrecognizedFormat'), duration: 3000 })
      return
    }

    // Route via the existing input router — handles sendable + non-sendable
    // (token-register, amount-action, unsupported) destinations identically.
    const target = routeValidatedInput(validated)
    setContactInfo(null)
    switch (target.screen) {
      case 'send':
        setValidatedScanData(target.validatedData)
        setScannedAmount(0)
        setPreviousScreen(currentScreen)
        setCurrentScreen('send')
        return
      case 'token-register':
        setInitialRegisterToken(target.token)
        setValidatedScanData(null)
        setPreviousScreen(currentScreen)
        setCurrentScreen('token-register')
        return
      case 'amount-action':
        setScannedAmount(target.amount)
        setValidatedScanData(null)
        setPreviousScreen(currentScreen)
        setCurrentScreen('amount-action')
        return
      case 'unsupported':
        addToast({ type: 'error', message: t('scanner.unrecognizedFormat'), duration: 3000 })
        return
    }
  }, [currentScreen, activeMintUrl, settings.mints, balance.byMint, serviceRegistry, addToast, t, setCurrentScreen, setPreviousScreen])

  /** Universal input router — navigate based on validated input type. */
  const handleRouteValidated = useCallback((data: ValidatedData) => {
    const target = routeValidatedInput(data)
    setContactInfo(null)
    switch (target.screen) {
      case 'send':
        setValidatedScanData(target.validatedData)
        setScannedAmount(0)
        setPreviousScreen(currentScreen)
        setCurrentScreen('send')
        return
      case 'token-register':
        setInitialRegisterToken(target.token)
        setValidatedScanData(null)
        setPreviousScreen(currentScreen)
        setCurrentScreen('token-register')
        return
      case 'amount-action':
        setScannedAmount(target.amount)
        setValidatedScanData(null)
        setPreviousScreen(currentScreen)
        setCurrentScreen('amount-action')
        return
      case 'unsupported':
        addToast({ type: 'error', message: t('scanner.unrecognizedFormat'), duration: 3000 })
        return
    }
  }, [currentScreen, addToast, t, setCurrentScreen, setPreviousScreen])

  // Initialize app — Coco 무관 작업만 (Coco는 unlock 후 setupSubscription에서 초기화)
  useEffect(() => {
    const init = async () => {
      try {
        // Load settings from IndexedDB (secure storage)
        const savedSettings = await preUnlock.settingsRepo.getSettings()
        setSettings(savedSettings)

        // Load failed swaps count
        const failedItems = await preUnlock.failedIncomingStore.findAll()
        setFailedIncomingsCount(failedItems.length)

        // Load transaction history
        const txHistory = await preUnlock.txRepo.findAll({ limit: 100 })
        setTransactions(txHistory)

        // Load cached exchange rates first, then fetch fresh in background
        await preUnlock.exchangeRate.loadCachedRates().catch(() => { })
        preUnlock.exchangeRate.fetchRates()

        // Data retention: clean up old records
        preUnlock.txRepo.deleteOlderThan(90).catch(() => { })
        preUnlock.failedIncomingStore.cleanupNonRetryable(30).catch(() => { })
        preUnlock.cleanupExpiredReceiveRequests().catch(() => { })
      } catch (error) {
        console.error('Init error:', error)
      } finally {
        setInitializing(false)
      }
    }

    init()
    // setTransactions는 useTransactions가 노출하는 React useState setter 패스스루 — 안정 식별자
  }, [preUnlock, setFailedIncomingsCount, setInitializing, setSettings, setTransactions])

  useEffect(() => {
    if (activeIncomingReview || pendingIncomingReviews.length === 0) return

    const nextReview = pendingIncomingReviews[0]
    setActiveIncomingReview(nextReview)
    setPreviousScreen(currentScreen === 'token-register' ? previousScreen : currentScreen)
    setCurrentScreen('token-register')
  }, [activeIncomingReview, pendingIncomingReviews, currentScreen, previousScreen, setCurrentScreen, setPreviousScreen])

  // Anchor check and State Reconstruction (ZAP-06)
  // Runs once when app is unlocked and has nostr keys
  const anchorCheckedRef = useRef(false)
  useEffect(() => {
    // Only run when unlocked, not initializing, has keys, and hasn't been checked yet
    if (isLocked || isInitializing || !nostrPubkey || !nostrPrivkey || !serviceRegistry) return
    if (anchorCheckedRef.current) return

    anchorCheckedRef.current = true

    const runRecovery = async () => {
      console.log('[App] Running recovery sync (anchor)')
      setIsRecovering(true)

      try {
        const result = await serviceRegistry.recovery.syncAll({
          privateKey: nostrPrivkey!,
          publicKey: nostrPubkey!,
          relays: settings.relays,
        })

        if (result.tokensReceived > 0) {
          console.log(`[App] Received ${result.tokensReceived} tokens from sync (${result.amountReceived} sats)`)
          await refreshAll()

          addToast({
            type: 'success',
            message: t('toast.ecashReceivedFromSync', { count: result.tokensReceived, amount: formatSats(result.amountReceived) }),
            duration: 5000,
          })
        }
      } catch (error) {
        console.error('[App] Recovery error:', error)
      } finally {
        setIsRecovering(false)
      }
    }

    runRecovery()
  }, [isLocked, isInitializing, nostrPubkey, nostrPrivkey, serviceRegistry, refreshAll, addToast, t, settings.relays])

  const isSendingEcashRef = useRef(false)

  useEffect(() => {
    // Only subscribe when app is unlocked and initialized
    if (isLocked || isInitializing || !serviceRegistry) return

    let cancelled = false

    const setupSubscription = async () => {
      // 1. Coco 초기화 + observers + watchers + EventBus bridge (composition root 경유)
      try {
        await serviceRegistry.activate()
      } catch (e) {
        console.error('[Init] Failed to activate Coco:', e)
      }

      if (cancelled) return

      // 2. 잔액 즉시 표시 + recovery 병렬 실행
      await refreshAndRecover()
    }

    setupSubscription()

    // Visibility change watcher — foreground/background 전환 감시
    const lifecycleWatcher = new AppLifecycleWatcher({
      onResume: async () => {
        await serviceRegistry.onResume()
        await refreshAndRecover()
      },
      onPause: () => serviceRegistry.onPause(),
    })
    lifecycleWatcher.start()

    return () => {
      cancelled = true
      lifecycleWatcher.stop()
    }
  }, [isLocked, isInitializing, serviceRegistry, refreshAndRecover])

  // Handle unlock
  const handleUnlock = useCallback(async (password: string): Promise<boolean> => {
    try {
      const result = await preUnlock.security.unlock(password)
      if (result.isOk()) {
        // Set nostr key pair in store
        setNostrKeyPair(result.value.keys.publicKey, result.value.keys.privateKey)

        // 자동잠금 해제 경량 경로 (감사 §6 / 전자 정책): 세션(레지스트리·소켓·
        // 구독)이 살아있으면 재부트스트랩하지 않는다 — security.unlock이 방금
        // 니모닉 캐시를 복원했고 키는 동일 지갑이다. 매 잠금 해제마다 전체
        // 재연결을 하면 네트워크 개편으로 없앤 버스트가 잠금 주기로 부활한다.
        if (serviceRegistry) {
          setLocked(false)
          return true
        }

        // Phase 5: Bootstrap service registry (new path, coexists with old)
        const registry = createBootstrap({
          nostrPrivateKeyHex: result.value.keys.privateKey,
          bip39Seed: result.value.bip39Seed,
        })
        // 재unlock 시 이전 세대 registry의 타이머/구독 정리 (flusher·TLS폴링 누수 방지)
        setServiceRegistry((prev) => {
          prev?.dispose()
          return registry
        })

        setLocked(false)

        // CashuModule 초기화 — fire-and-forget (UI 블로킹 제거, QA #4)
        // SDK init 완료 후 balance 갱신 (BootstrapResult.refreshBalance 사용)
        registry.cashuModule.initialize().then(() => {
          registry.refreshBalance().catch((e) => console.error('[Unlock] Post-init balance refresh failed:', e))
        }).catch((e) => console.error('[Unlock] CashuModule init failed:', e))

        // P2PK key — SDK init을 블로킹하지 않고 백그라운드 로드
        registry.p2pkKeyManager.getCurrentKey().then(({ pubkey }) => setP2pkPubkey(pubkey))
        return true
      }
      return false
    } catch {
      return false
    }
  }, [preUnlock.security, setLocked, setNostrKeyPair, setP2pkPubkey, serviceRegistry])

  // 보안 핸들러 (자동잠금/PIN 변경·검증/니모닉 백업/로그아웃) — Phase 4b 추출.
  // handleUnlock은 부트스트랩 심(레지스트리 세대 교체 + composition 배선)이라 잔류.
  // wipeAccount는 composition 소거 배선(wipeAccountData + registry + removePasskey)을
  // MainApp이 묶어 주입 — 훅은 core 포트만 의존한다.
  const wipeAccount = useCallback(
    () => wipeAccountData({ security: preUnlock.security, registry: serviceRegistry, removePasskey }),
    [preUnlock.security, serviceRegistry],
  )
  const {
    handleAutoLock,
    handleChangePassword,
    handleVerifyPin,
    handleBackupMnemonic,
    handleLogout,
  } = useSecurityHandlers({ security: preUnlock.security, wipeAccount })

  useAutoLock({
    enabled: settings.autoLockEnabled ?? true,
    timeoutMinutes: settings.autoLockTimeoutMinutes ?? 5,
    isLocked,
    onLock: handleAutoLock,
  })

  const clearIncomingReviewState = useCallback(() => {
    setActiveIncomingReview(null)
    setValidatedScanData(null)
  }, [])

  // 거절 확정 후 UI 리셋 — 리뷰/스캔 파라미터와 네비 상태는 MainApp 소유 (훅에 콜백 주입)
  const handleIncomingReviewRejected = useCallback(() => {
    clearIncomingReviewState()
    setCurrentScreen(previousScreen || 'home')
    setPreviousScreen(null)
  }, [clearIncomingReviewState, previousScreen, setCurrentScreen, setPreviousScreen])

  // 수신 핸들러 (인보이스 생성/토큰 상환/요청 이행/리뷰 승인·거절/수신 브로드캐스트) — Phase 4c 추출.
  // resolveIncomingReview는 composition 함수라 주입 — 훅은 core 포트만 의존한다.
  const {
    handleCreateInvoice,
    handleReceiveToken,
    handleReceiveRequestFulfillment,
    handleResolveIncomingReview,
    handleRejectIncomingReview,
    handlePaymentReceived,
  } = useReceiveHandlers({
    serviceRegistry,
    refreshAll,
    resolveReview: resolveIncomingReview,
    onRejected: handleIncomingReviewRejected,
  })

  // 크로스민트 스왑 핸들러 (스왑/상환 수수료 견적 + 상환→스왑 수신 + 민트 간 스왑) — Phase 4c 추출
  const {
    handleEstimateSwapFee,
    handleEstimateRedeemFee,
    handleSwapReceive,
    handleMintSwap,
  } = useSwapHandlers({ serviceRegistry, refreshAll })

  /** Unified send handler via routing layer */
  const handleExecuteRoute = useCallback(async (
    selection: RouteSelection,
    context: RouteContext,
  ): Promise<RouteExecutionResult | null> => {
    if (!serviceRegistry) return null
    try {
      const result = await serviceRegistry.executeRoute(selection, context)

      if (result.isOk()) {
        refreshAll().catch((e) => console.error('[MainApp] refreshAll after route execution:', e))
        return result.value
      }

      console.error('[MainApp] Route execution failed:', result.error)
      addToast({ type: 'error', message: toErrorMessage(result.error), duration: 4000 })
      return null
    } catch (error) {
      console.error('[MainApp] handleExecuteRoute error:', error)
      return null
    }
  }, [serviceRegistry, refreshAll, addToast])

  const handleCreateEcashToken = useCallback(async (amount: number, preferredMintUrl?: string, options?: { p2pkPubkey?: string; memo?: string }): Promise<{ token: string; txId: string; operationId: string } | null> => {
    if (isSendingEcashRef.current) return null
    if (!serviceRegistry?.transferLifecycle) {
      console.warn('[MainApp] ServiceRegistry not ready — cannot create ecash token')
      return null
    }
    isSendingEcashRef.current = true
    try {
      // TLS 경로: TransferLifecycleService 사용
      // TODO: P2PK locking condition은 TransferIntent에 추가 필요
      const txId = crypto.randomUUID()
      const transfer = await serviceRegistry.transferLifecycle.initiateTransfer(
        {
          txId,
          accountId: preferredMintUrl ?? '',
          amount: sat(amount),
          memo: options?.memo,
          // recipient 없음 = token creation mode
        },
        'ecash'
      )

      // Ecash는 prepare+execute가 동기적으로 완료됨
      // transportRef.token에 생성된 토큰이 저장됨
      const token = (transfer.transportRef as { token?: string })?.token ?? ''
      const operationId = (transfer.transportRef as { operationId?: string })?.operationId ?? ''

      if (!token) {
        console.error('[MainApp] Token creation failed: no token in transportRef')
        return null
      }

      await refreshBalance()
      broadcastSync('balance_changed')

      return { token, txId, operationId }
    } catch (error) {
      console.error('Failed to create ecash token:', error)
      if (error instanceof InsufficientBalanceError) throw error
      return null
    } finally {
      isSendingEcashRef.current = false
    }
  }, [serviceRegistry, refreshBalance])

  // ─── 토큰 생성 전 수수료 견적 ───
  const handleEstimateCreateFee = useCallback(
    async (mintUrl: string, amount: number): Promise<number | null> => {
      if (!serviceRegistry?.payment) return null
      try {
        const result = await serviceRegistry.payment.estimateFee({
          accountId: mintUrl,
          destination: '',
          amount: sat(amount),
        })
        if (!result.ok) return null
        return toNumber(result.value.fee)
      } catch {
        return null
      }
    },
    [serviceRegistry],
  )

  // ─── 되찾기(수취) 수수료 견적 — 이미 생성된 tx ───
  const handleQuoteReclaim = useCallback(
    async (txId: string): Promise<number | null> => {
      if (!serviceRegistry?.payment) return null
      try {
        const result = await serviceRegistry.payment.quoteReclaim({ transactionId: txId })
        if (!result.ok) return null
        return toNumber(result.value.fee)
      } catch {
        return null
      }
    },
    [serviceRegistry],
  )

  // ─── 등록 중인 토큰이 내가 생성한 pending send 인지 확인 ───
  const handleCheckSelfToken = useCallback(
    async (tokenString: string): Promise<{ txId: string; amount: number } | null> => {
      if (!serviceRegistry?.pendingItems) return null
      try {
        const items = await serviceRegistry.pendingItems.getAll()
        const match = items.find(
          (item) =>
            item.direction === 'send' &&
            item.kind === 'token' &&
            (item.details as { token?: string } | undefined)?.token === tokenString,
        )
        if (!match) return null
        return { txId: match.id, amount: match.amount }
      } catch {
        return null
      }
    },
    [serviceRegistry],
  )

  // 민트/설정 핸들러 (설정 저장 + 프로필 재발행 + 신뢰 민트 추가) — Phase 4b 추출.
  // republishProfile은 이 두 핸들러 전용이라 훅 내부로 캡슐화.
  const { handleSaveSettings, handleAddTrustedMint } = useMintHandlers({
    serviceRegistry,
    settingsRepo: preUnlock.settingsRepo,
  })

  const handleSendRedirect = useCallback((validated: ValidatedData) => {
    setValidatedScanData(validated)
    setCurrentScreen('receive')
    addToast({ type: 'info', message: t('redirect.toReceive') })
  }, [addToast, t, setCurrentScreen])

  // Preload lazy screens after home is visible
  useEffect(() => {
    if (isInitializing || isLocked) return
    const timer = setTimeout(() => {
      import('@/ui/screens/Settings/SettingsScreen')
      import('@/ui/screens/Contacts/ContactsScreen')
      import('@/ui/screens/History/HistoryScreen')
      import('@/ui/screens/Transfer/TransferScreen')
      import('@/ui/screens/Notifications/NotificationsScreen')
      import('@/ui/screens/Analytics/AnalyticsScreen')
    }, 1000)
    return () => clearTimeout(timer)
  }, [isInitializing, isLocked])

  // Suppress unused variable warnings
  void isOnline
  void isRecovering

  // Loading state
  if (isInitializing) {
    return (
      <div className="flex items-center justify-center h-dvh bg-background">
        <div className="text-center">
          <h1 className="text-title font-bold text-brand mb-4">ZAPPI</h1>
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  // Lock screen
  if (isLocked) {
    return <LockScreen onUnlock={handleUnlock} />
  }

  // ─── 화면 라우트 테이블 (Phase 4d) ──────────────────────────────────────
  // Screen → 렌더 함수 매핑. 각 렌더 함수는 기존 `{currentScreen === 'x' && (…)}`
  // 분기의 JSX를 그대로 반환한다 (순수 이동 — prop/구조 변경 없음). 컴포넌트
  // 스코프 클로저라 매 렌더 최신 상태를 캡처한다 — useMemo 금지(스냅샷 고착).
  //
  // 예외 (테이블 밖 JSX 분기로 잔류 — 기계 변환 불가):
  // - 'token' / 'token-detail': TokenScreen 베이스 + TokenDetailScreen 슬라이드
  //   오버레이가 내부 AnimatePresence로 결합된 단일 블록. PageTransition key도
  //   'token' 하나를 공유해 두 화면 전환 시 베이스가 리마운트되지 않아야 한다 —
  //   화면당 1엔트리 테이블로 옮기면 오버레이 exit 애니메이션과 TokenScreen
  //   상태 보존이 깨진다. Suspense 내부 JSX 분기로 잔류.
  //
  // state 가드 3곳 (currentScreen 외 상태 조건이 걸린 렌더):
  // - 'transaction-detail': selectedTransaction 없으면 렌더 안 함 — 가드 내장 렌더 함수
  // - 'mint-detail': selectedMint 없으면 렌더 안 함 — 가드 내장 렌더 함수
  // - 'token-detail' 오버레이: selectedTokenDetail 가드 — 위 결합 블록 예외 내부에 잔류
  const screenRoutes: Partial<Record<Screen, () => ReactNode>> = {
    home: () => (
      <HomeScreen
        onTransactions={(mintUrl?: string) => {
          setHistoryInitialMintUrls(mintUrl ? [mintUrl] : undefined)
          setCurrentScreen('history')
        }}
        onNotifications={() => setCurrentScreen('notifications')}
        onAddMint={() => setCurrentScreen('add-mint')}
        onMintDetails={(mint, index) => {
          setSelectedMint(mint)
          setSelectedMintIndex(index)
          setPreviousScreen('home')
          setCurrentScreen('mint-detail')
        }}
        onSend={(mintUrl) => {
          setPreviousScreen('home')

          setActiveMintUrl(mintUrl || null)
          setValidatedScanData(null)
          setScannedAmount(0)
          setCurrentScreen('send')
        }}
        onReceive={(mintUrl) => {
          setPreviousScreen('home')
          setActiveMintUrl(mintUrl || null)
          setValidatedScanData(null)
          setScannedAmount(0)
          setCurrentScreen('receive')
        }}
        onScan={() => setShowHomeScanner(true)}
        onSelectTransaction={(tx) => {
          setSelectedTransaction(tx)
          setPreviousScreen('home')
          setCurrentScreen('transaction-detail')
        }}
        onSaveSettings={handleSaveSettings}
        onRefresh={handleManualRefresh}
        transactions={transactions}
      />
    ),

    settings: () => (
      <SettingsScreen
        onBack={() => handleTabSelect('wallet')}
        onChangePassword={handleChangePassword}
        onBackupMnemonic={handleBackupMnemonic}
        onLogout={handleLogout}
        onVerifyPin={handleVerifyPin}
        onSaveSettings={handleSaveSettings}
        onMintManagement={() => {
          setPreviousScreen('settings')
          setCurrentScreen('mint-management')
        }}
        onRelayManagement={() => {
          setPreviousScreen('settings')
          setCurrentScreen('relay-management')
        }}
        onChangeUsername={() => {
          setPreviousScreen('settings')
          setCurrentScreen('username-change')
        }}
        onTransfer={() => {
          setPreviousScreen('settings')
          setCurrentScreen('transfer')
        }}
        onAnalytics={() => {
          setPreviousScreen('settings')
          setCurrentScreen('analytics')
        }}
        onSubPageChange={setHasSettingsSubPage}
      />
    ),

    'token-easter-egg': () => (
      <EasterEggScreen onClose={handleBack} />
    ),

    contacts: () => (
      <ContactsScreen
        onSendToContact={(validatedData, displayName, mintUrl) => {
          setPreviousScreen('contacts')
          setActiveMintUrl(mintUrl)
          setValidatedScanData(validatedData)
          setScannedAmount(0)
          setContactInfo({ address: '', displayName })
          setCurrentScreen('send')
        }}
      />
    ),

    'username-change': () => (
      <UsernameChangeScreen
        onBack={handleBack}
        onSaveSettings={handleSaveSettings}
      />
    ),

    history: () => (
      <HistoryScreen
        onBack={handleBack}
        transactions={transactions}
        initialMintUrls={historyInitialMintUrls}
      />
    ),

    notifications: () => (
      <NotificationsScreen
        onBack={handleBack}
        transactions={transactions}
      />
    ),

    transfer: () => (
      <TransferScreen
        onBack={handleBack}
        onTransactionComplete={refreshAll}
        initialFromMintUrl={activeMintUrl ?? undefined}
      />
    ),

    analytics: () => (
      <AnalyticsScreen
        onBack={handleBack}
        transactions={transactions}
      />
    ),

    'add-mint': () => (
      <AddMintScreen
        onBack={() => {
          const backTo = previousScreen || 'home'
          setPreviousScreen(null)
          setCurrentScreen(backTo)
        }}
        onSuccess={() => {
          const backTo = previousScreen || 'home'
          setPreviousScreen(null)
          setCurrentScreen(backTo)
        }}
        onSaveSettings={handleSaveSettings}
      />
    ),

    'mint-management': () => (
      <MintManagementScreen
        onBack={handleBack}
        onAddMint={() => {
          setPreviousScreen('mint-management')
          setCurrentScreen('add-mint')
        }}
        onSaveSettings={handleSaveSettings}
        onClearMintData={serviceRegistry ? (mintUrl) => serviceRegistry.cleanup.clearMintData(mintUrl) : undefined}
      />
    ),

    'relay-management': () => (
      <RelayManagementScreen
        onBack={handleBack}
        onSaveSettings={handleSaveSettings}
      />
    ),

    'amount-action': () => (
      <AmountActionScreen
        amount={scannedAmount}
        mode={undefined}
        onBack={handleBack}
        onSend={(amount) => {
          setScannedAmount(amount)
          setValidatedScanData(null)

          setPreviousScreen('amount-action')
          setCurrentScreen('send')
        }}
        onReceive={(amount) => {
          setScannedAmount(amount)
          setValidatedScanData(null)
          setPreviousScreen('amount-action')
          setCurrentScreen('receive')
        }}
      />
    ),

    send: () => (
      <SendFlow
        onBack={() => {
          const backTo = previousScreen || 'home'
          setPreviousScreen(null)
          setContactInfo(null)
          setCurrentScreen(backTo)
        }}
        onComplete={() => {
          setPreviousScreen(null)
          setContactInfo(null)
          setCurrentScreen('home')
        }}
        onExecuteRoute={handleExecuteRoute}
        onMintSwap={handleMintSwap}
        onEstimateSwapFee={handleEstimateSwapFee}
        onRouteValidated={handleRouteValidated}
        validatedData={validatedScanData || undefined}
        initialAmount={scannedAmount || undefined}
        initialMintUrl={activeMintUrl}
        initialDestination={contactInfo?.address || undefined}
        initialDisplayName={contactInfo?.displayName || undefined}
        onRedirect={handleSendRedirect}
      />
    ),

    'token-create': () => (
      <TokenCreateFlow
        mintUrl={(() => {
          // Prefer active mint if it has balance, otherwise first mint with balance,
          // otherwise fall back to active mint or first configured mint.
          if (activeMintUrl && (balance.byMint[activeMintUrl] ?? 0) > 0) return activeMintUrl
          const withBalance = settings.mints.find((url) => (balance.byMint[url] ?? 0) > 0)
          if (withBalance) return withBalance
          return activeMintUrl ?? settings.mints[0] ?? ''
        })()}
        onBack={() => {
          const backTo = previousScreen || 'token'
          setPreviousScreen(null)
          setCurrentScreen(backTo)
        }}
        onComplete={() => {
          setPreviousScreen(null)
          setCurrentScreen('token')
        }}
        onCreateToken={(amount, mintUrl, memo) =>
          handleCreateEcashToken(amount, mintUrl, { memo })
        }
        onCancelToken={async (txId) => {
          if (!serviceRegistry?.reclaim?.reclaim) {
            addToast({ type: 'error', message: t('errors.serviceNotReady') })
            return
          }
          const result = await serviceRegistry.reclaim.reclaim(txId)
          if (result.ok) {
            addToast({ type: 'success', message: t('token.reclaim.success') })
          } else {
            const errorMessage = result.error
              ? translateError(result.error, t)
              : t('token.reclaim.failed')
            addToast({ type: 'error', message: errorMessage })
          }
        }}
        onEstimateFee={handleEstimateCreateFee}
        onQuoteReclaim={handleQuoteReclaim}
      />
    ),

    'token-register': () => (
      <TokenRegisterFlow
        onBack={() => {
          const backTo = previousScreen || 'token'
          clearIncomingReviewState()
          setPreviousScreen(null)
          setInitialRegisterToken('')
          setCurrentScreen(backTo)
        }}
        onComplete={() => {
          clearIncomingReviewState()
          setPreviousScreen(null)
          setInitialRegisterToken('')
          setCurrentScreen('token')
        }}
        onReceiveToken={handleReceiveToken}
        onAddTrustedMint={handleAddTrustedMint}
        onSwapReceive={handleSwapReceive}
        onEstimateRedeemFee={handleEstimateRedeemFee}
        onCheckSelfToken={handleCheckSelfToken}
        onReclaimOwnToken={async (txId) => {
          if (!serviceRegistry?.reclaim?.reclaim) {
            return { amount: 0 }
          }
          const result = await serviceRegistry.reclaim.reclaim(txId)
          return { amount: result.ok ? result.value.amount.value : 0 }
        }}
        onRouteValidated={handleRouteValidated}
        initialToken={initialRegisterToken}
        targetMintUrl={activeMintUrl ?? settings.mints[0] ?? undefined}
        incomingReview={activeIncomingReview}
        onResolveIncomingReview={(params) =>
          activeIncomingReview
            ? handleResolveIncomingReview({ review: activeIncomingReview, transactionId: params.transactionId })
            : Promise.resolve()
        }
        onRejectIncomingReview={() =>
          activeIncomingReview ? handleRejectIncomingReview(activeIncomingReview) : Promise.resolve()
        }
      />
    ),

    receive: () => (
      <ReceiveFlow
        onBack={() => {
          const backTo = previousScreen || 'home'
          setPreviousScreen(null)
          setCurrentScreen(backTo)
        }}
        onComplete={() => {
          setPreviousScreen(null)
          setCurrentScreen('home')
        }}
        onCreateInvoice={handleCreateInvoice}
        onPaymentReceived={handlePaymentReceived}
        onReceiveRequestFulfilled={handleReceiveRequestFulfillment}
        initialAmount={scannedAmount || undefined}
        initialMintUrl={activeMintUrl}
      />
    ),

    'transaction-detail': () => selectedTransaction && (
      <TransactionDetailScreen
        transaction={selectedTransaction}
        onBack={() => {
          setSelectedTransaction(null)
          handleBack()
        }}
        mintUrls={settings.mints}
      />
    ),

    'mint-detail': () => selectedMint && (
      <MintDetailScreen
        mint={selectedMint}
        mintIndex={selectedMintIndex}
        onBack={handleBack}
        onCreateToken={(mintUrl) => {
          setPreviousScreen('mint-detail')
          setActiveMintUrl(mintUrl)
          setValidatedScanData(null)
          setScannedAmount(0)
          setCurrentScreen('send')
        }}
        onDeleteMint={async (url) => {
          if (settings.mints.length <= LIMITS.MIN_MINTS) {
            addToast({ type: 'warning', message: t('settings.minMintsRequired', { min: LIMITS.MIN_MINTS }) })
            return
          }
          const newMints = settings.mints.filter(m => m !== url)
          const { [url]: _, ...remainingAliases } = settings.mintAliases || {}
          const { [url]: _color, ...remainingColors } = settings.mintColors || {}
          const { [url]: _preset, ...remainingCardDesignPresets } = settings.mintCardDesignPresets || {}
          await handleSaveSettings({
            mints: newMints,
            mintAliases: remainingAliases,
            mintColors: remainingColors,
            mintCardDesignPresets: remainingCardDesignPresets,
          })
          await serviceRegistry?.cleanup.clearMintData(url)
          setCurrentScreen('home')
          addToast({ type: 'success', message: t('mintDetail.mintDeleted') })
        }}
        onRenameMint={(url, newName) => {
          const newAliases = { ...settings.mintAliases, [url]: newName }
          handleSaveSettings({ mintAliases: newAliases })
          if (selectedMint && selectedMint.url === url) {
            setSelectedMint({ ...selectedMint, alias: newName, name: newName })
          }
        }}
        onChangeMintColor={(url, color) => {
          const newColors = { ...settings.mintColors, [url]: color }
          handleSaveSettings({ mintColors: newColors })
        }}
        onChangeMintCardDesign={(url, preset) => {
          const newPresets = { ...settings.mintCardDesignPresets, [url]: preset }
          handleSaveSettings({ mintCardDesignPresets: newPresets })
        }}
        onSelectTransaction={(tx) => {
          setSelectedTransaction(tx)
          setPreviousScreen('mint-detail')
          setCurrentScreen('transaction-detail')
        }}
        onTransactions={() => {
          setHistoryInitialMintUrls(selectedMint ? [selectedMint.url] : undefined)
          setPreviousScreen('mint-detail')
          setCurrentScreen('history')
        }}
        transactions={transactions}
        onFindTransaction={serviceRegistry ? (id: string) => serviceRegistry.transactionMgmt.getById(id) : undefined}
        pendingItemCallbacks={serviceRegistry ? {
          onRedeemToken: async (tokenStr: string, _itemId: string) => {
            const result = await serviceRegistry.payment.redeem({ input: tokenStr })
            return result.ok
          },
          onCheckQuote: async (mintUrl: string, quoteId: string) => {
            const { getMintQuote } = await import('@/modules/cashu')
            const quote = await getMintQuote(mintUrl, quoteId)
            return quote ? { state: quote.state, request: quote.request } : null
          },
          onRedeemQuote: async (mintUrl: string, quoteId: string, amount: number) => {
            const { redeemMintQuote } = await import('@/modules/cashu')
            await redeemMintQuote(mintUrl, quoteId, amount)
          },
          onPendingItemChanged: async () => {
            await refreshAll()
          },
        } : undefined}
      />
    ),
  }


  // Main app content
  const mainContent = (
    <>
      <div className="relative h-dvh overflow-hidden">
        <AnimatePresence mode="sync">
          <PageTransition
            key={currentScreen === 'token-detail' ? 'token' : currentScreen}
            variant="fade"
            className="absolute inset-0"
          >
            <Suspense fallback={<LoadingFallback />}>
              {screenRoutes[currentScreen]?.()}

              {/* Token flow: TokenScreen always rendered as base, TokenDetailScreen overlays with slide animation */}
              {/* Phase 4d 예외 잔류: 'token'/'token-detail' 결합 블록 — 사유는 screenRoutes 상단 주석 참조 */}
              {(currentScreen === 'token' || currentScreen === 'token-detail') && (
                <div className="relative w-full h-full">
                  {/* Base TokenScreen - always visible in token flow */}
                  <TokenScreen
                    scrollRef={tokenScrollRef}
                    onSelectToken={(detail) => {
                      console.log('[MainApp] onSelectToken called', detail)
                      setSelectedTokenDetail(detail)
                      setPreviousScreen('token')
                      setCurrentScreen('token-detail')
                      console.log('[MainApp] setCurrentScreen to token-detail')
                    }}
                    onSaveSettings={handleSaveSettings}
                  />

                  {/* TokenDetailScreen - slides in from right as overlay */}
                  <AnimatePresence>
                    {currentScreen === 'token-detail' && selectedTokenDetail && (
                      <motion.div
                        key="token-detail"
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="absolute inset-0 z-50"
                      >
                        <TokenDetailScreen
                          data={selectedTokenDetail}
                          onClose={() => {
                            console.log('[MainApp] TokenDetailScreen onClose - resetting')
                            setSelectedTokenDetail(null)
                            setCurrentScreen('token')
                          }}
                          onShare={async (token) => {
                            const text = token.tokenString
                              ? token.tokenString
                              : t('token.reclaimable.shareText', {
                                memo: token.memo ?? '',
                                amount: formatSats(token.amount),
                              })
                            try {
                              if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                                await navigator.share({ text })
                                return
                              }
                              if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                                await navigator.clipboard.writeText(text)
                                addToast({ type: 'success', message: t('token.reclaimable.copiedToClipboard') })
                              }
                            } catch {
                              /* user cancelled or clipboard blocked — silent */
                            }
                          }}
                          onReclaim={async (token) => {
                            if (!serviceRegistry?.reclaim?.reclaim) {
                              addToast({ type: 'error', message: t('errors.serviceNotReady') })
                              return
                            }
                            const result = await serviceRegistry.reclaim.reclaim(token.id)
                            if (result.ok) {
                              setSelectedTokenDetail(null)
                              handleBack()
                              addToast({ type: 'success', message: t('token.reclaim.success') })
                            } else {
                              const errorMessage = result.error
                                ? translateError(result.error, t)
                                : t('token.reclaim.failed')
                              addToast({ type: 'error', message: errorMessage })
                            }
                          }}
                          onTriggerEasterEgg={() => {
                            setPreviousScreen('token-detail')
                            setCurrentScreen('token-easter-egg')
                          }}
                          onDeleteHistory={async (token) => {
                            if (!serviceRegistry?.transactionMgmt) return
                            try {
                              await serviceRegistry.transactionMgmt.delete(token.id)
                              useAppStore.getState().triggerTxRefresh()
                              addToast({ type: 'success', message: t('token.history.deleteSuccess') })
                            } catch (error) {
                              console.error('[MainApp] Failed to delete tx history:', error)
                              addToast({ type: 'error', message: t('token.history.deleteFailed') })
                            }
                          }}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </Suspense>
          </PageTransition>
        </AnimatePresence>

      </div>

      {/* Bottom Navigation — MainTabToolbar / TokenTabToolbar swap */}
      <AnimatePresence mode="wait" initial={false}>
        {isTabScreen && activeTab !== 'token' && (
          <MainTabToolbar
            key="main-tab-toolbar"
            navItems={navItems}
            activeTab={activeTab}
            onTabSelect={handleTabSelect}
          />
        )}
        {isTabScreen && activeTab === 'token' && (
          <TokenTabToolbar
            key="token-tab-toolbar"
            navItems={navItems}
            activeTab={activeTab}
            scrollRef={tokenScrollRef}
            onTabSelect={handleTabSelect}
            onCreate={() => {
              setPreviousScreen('token')
              setCurrentScreen('token-create')
            }}
            onRegister={() => {
              setPreviousScreen('token')
              setCurrentScreen('token-register')
            }}
          />
        )}
      </AnimatePresence>

      {/* Home camera shortcut — top-right scan */}
      <QrScannerModal
        isOpen={showHomeScanner}
        onClose={() => setShowHomeScanner(false)}
        onScan={handleHomeScanResult}
      />

      {/* NIP-19 camera scan — mint selection sheet (matches ContactsScreen) */}
      <MintSelectBottomSheet
        isOpen={npubMintSelection !== null}
        onClose={() => setNpubMintSelection(null)}
        onSelect={(mintUrl) => {
          if (!npubMintSelection) return
          setActiveMintUrl(mintUrl)
          setValidatedScanData(npubMintSelection.validatedData)
          setScannedAmount(0)
          setContactInfo({ address: '', displayName: formatNpubShort(npubMintSelection.rawAddress) })
          setPreviousScreen(currentScreen)
          setCurrentScreen('send')
          setNpubMintSelection(null)
        }}
        selectedMintUrl={null}
        filterFn={npubMintSelection
          ? (mint) => npubMintSelection.commonMintUrls.some(
              (url) => isSameMintUrl(url, mint.url)
            )
          : undefined}
      />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </>
  )

  // Phase 5: ServiceProvider로 감싸기 (registry 존재 시)
  if (serviceRegistry) {
    return (
      <ServiceProvider registry={serviceRegistry}>
        {mainContent}
      </ServiceProvider>
    )
  }

  return mainContent
}
