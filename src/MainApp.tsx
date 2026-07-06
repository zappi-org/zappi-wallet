import { AppLifecycleWatcher } from '@/composition/app-lifecycle.watcher'
import { createBootstrap, type BootstrapResult, type RouteContext, type RouteExecutionResult, type RouteSelection } from '@/composition/bootstrap'
import { resolveIncomingReview } from '@/composition/incoming-review'
import { createPreUnlockServices } from '@/composition/pre-unlock'
import { wipeAccountData } from '@/composition/logout'
import { DEFAULT_RELAYS, LIMITS } from '@/core/constants'
import { sat, toNumber } from '@/core/domain/amount'
import type { BaseError } from '@/core/errors/base'
import { ServiceNotReadyError } from '@/core/errors/base'
import { InsufficientBalanceError } from '@/core/errors/payment.errors'
import { ServiceProvider } from '@/ui/hooks/service-context'
import { useAutoLock } from '@/ui/hooks/use-auto-lock'
import { useCrossTabSync } from '@/ui/hooks/use-cross-tab-sync'
import { useGlobalTokenClaimToast } from '@/ui/hooks/use-global-token-claim-toast'

import { useRedeemToken } from '@/ui/hooks/use-redeem-token'
import { useSupportNotifications } from '@/ui/hooks/use-support-notifications'
import { isNostrDirectAddress } from '@/core/domain/nostr-address'
import { translateError } from '@/ui/utils/error-i18n'
import { broadcastSync } from '@/utils/cross-tab-sync'
// useMintHealth removed — mint health checks done via serviceRegistry directly
import { useAppStore } from '@/store'
import { useNetwork } from '@/ui/hooks/use-network'
import { useWallet } from '@/ui/hooks/use-wallet'
import { setMintNameResolver, toErrorMessage } from '@/ui/utils/error-message'
import { normalizeMintUrl, isSameMintUrl } from '@/utils/url'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { generateMintAliases } from '@/utils/mint-name'


type Screen = 'home' | 'token' | 'settings' | 'contacts' | 'history' | 'notifications' | 'transfer' | 'analytics' | 'add-mint' | 'mint-management' | 'relay-management' | 'amount-action' | 'send' | 'receive' | 'username-change' | 'transaction-detail' | 'mint-detail' | 'token-create' | 'token-register' | 'token-detail' | 'token-easter-egg'

type TabId = 'wallet' | 'token' | 'contacts' | 'settings'
const TAB_SCREENS: Record<TabId, Screen> = { wallet: 'home', token: 'token', contacts: 'contacts', settings: 'settings' }
const SCREEN_TO_TAB: Partial<Record<Screen, TabId>> = { home: 'wallet', token: 'token', contacts: 'contacts', settings: 'settings' }

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
  const p2pkPubkey = useAppStore((state) => state.p2pkPubkey)
  const txRefreshTrigger = useAppStore((state) => state.txRefreshTrigger)
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
  const removeIncomingReview = useAppStore((state) => state.removeIncomingReview)

  // Service Registry (Phase 5: bootstrap 후 생성, unlock 전에는 null)
  const [serviceRegistry, setServiceRegistry] = useState<BootstrapResult | null>(null)

  // Hooks
  const { refreshBalance, balance } = useWallet()
  const { isOnline } = useNetwork()
  const [isRecovering, setIsRecovering] = useState(false)

  useCrossTabSync()
  useGlobalTokenClaimToast(serviceRegistry)
  useSupportNotifications(serviceRegistry)

  // Local state
  const [currentScreen, setCurrentScreen] = useState<Screen>('home')
  const [previousScreen, setPreviousScreen] = useState<Screen | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  // Derive active tab from current screen
  const activeTab: TabId = SCREEN_TO_TAB[currentScreen] ?? 'wallet'

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

  // Whether current screen is a tab screen (show bottom nav)
  const [hasSettingsSubPage, setHasSettingsSubPage] = useState(false)
  const isTabScreen = !!SCREEN_TO_TAB[currentScreen] && !hasSettingsSubPage

  // Handle tab selection
  const handleTabSelect = useCallback((tabId: string) => {
    setCurrentScreen(TAB_SCREENS[tabId as TabId])
    setPreviousScreen(null)
  }, [])

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

  /** Refresh balance + transaction history in parallel */
  const refreshAll = useCallback(async () => {
    const balancePromise = serviceRegistry
      ? serviceRegistry.refreshBalance()
      : refreshBalance()
    const [, txHistory] = await Promise.all([
      balancePromise,
      preUnlock.txRepo.findAll({ limit: 100 }),
    ])
    setTransactions(txHistory)
  }, [serviceRegistry, refreshBalance, preUnlock.txRepo])

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
  }, [currentScreen, activeMintUrl, settings.mints, balance.byMint, serviceRegistry, addToast, t])

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
  }, [currentScreen, addToast, t])

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
  }, [preUnlock, setFailedIncomingsCount, setInitializing, setSettings])

  // Reload transactions and balance when txRefreshTrigger changes (e.g., GiftWrap token receipt)
  useEffect(() => {
    if (txRefreshTrigger === 0) return
    refreshAll()
  }, [txRefreshTrigger, refreshAll])

  useEffect(() => {
    if (activeIncomingReview || pendingIncomingReviews.length === 0) return

    const nextReview = pendingIncomingReviews[0]
    setActiveIncomingReview(nextReview)
    setPreviousScreen(currentScreen === 'token-register' ? previousScreen : currentScreen)
    setCurrentScreen('token-register')
  }, [activeIncomingReview, pendingIncomingReviews, currentScreen, previousScreen])

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

  // 자동잠금 (감사 §6 실구현, 전자 정책): 유휴 시간 초과 시 UI 잠금 + 메모리
  // 비밀(키·시드·니모닉 캐시) 소거. 레지스트리는 유지 — PWA는 OS 푸시가 없어
  // "앱이 살아있는 동안의 수신"이 전부이고, 세션을 죽이면 해제마다 재연결
  // 버스트가 부활한다. 화면 복귀 시 즉시 재판정(freeze 중 타이머 정지 보완).
  const handleAutoLock = useCallback(() => {
    preUnlock.security.lock()
    setLocked(true)
  }, [preUnlock.security, setLocked])

  useAutoLock({
    enabled: settings.autoLockEnabled ?? true,
    timeoutMinutes: settings.autoLockTimeoutMinutes ?? 5,
    isLocked,
    onLock: handleAutoLock,
  })

  // Payment modal handlers
  const handleCreateInvoice = useCallback(async (amount: number, mintUrl: string) => {
    if (!mintUrl) return null

    if (!serviceRegistry?.payment) {
      console.warn('[MainApp] ServiceRegistry not ready — cannot create invoice')
      return null
    }
    const transfer = await serviceRegistry.transferLifecycle.initiateIncomingTransfer(
      { txId: crypto.randomUUID(), accountId: mintUrl, amount: sat(amount) }, 'bolt11'
    )

    const ref = transfer.transportRef as { request?: string, quoteId?: string }

    return {
      invoice: ref?.request ?? '',
      quoteId: ref?.quoteId ?? '',
      expiry: transfer.expiresAt ? Math.floor(transfer.expiresAt / 1000) : Math.floor(Date.now() / 1000) + 600,
    }
  }, [serviceRegistry])

  const handleReceiveToken = useRedeemToken(serviceRegistry, () => {
    refreshAll().catch((e) => console.error('[MainApp] refreshAll after receive failed:', e))
  })

  /**
   * Handle an incoming token that fulfills one of MY ReceiveRequests.
   * Routes through the domain use case so settlement → my-id verification →
   * intent='request-fulfill' tagging happens in one place. Transport-agnostic
   * (HTTP polling, future transports). Uses paymentRef as both externalId
   * (idempotency / deterministic txId) and the receive-request match key.
   */
  const handleReceiveRequestFulfillment = useCallback(async (
    token: string,
    paymentRef: string,
  ): Promise<{ success: boolean; amount?: number; requestFulfilled?: boolean; error?: { code?: string; message?: string } }> => {
    if (!serviceRegistry?.incomingPayment) {
      return { success: false, error: { code: 'NOT_READY', message: 'ServiceRegistry not ready' } }
    }

    const result = await serviceRegistry.incomingPayment.processIncoming({
      payload: token,
      externalId: paymentRef,
      receiveRequestPaymentRef: paymentRef,
      receiveRequestMethod: 'ecash',
    })

    if (result.status === 'success') {
      refreshAll().catch((e) => console.error('[MainApp] refreshAll after fulfillment failed:', e))
      return { success: true, amount: result.amount, requestFulfilled: result.requestFulfilled }
    }
    if (result.status === 'already_processed') {
      return { success: true, amount: 0 }
    }
    return { success: false, error: { code: 'FULFILLMENT_FAILED', message: result.error ?? 'Failed to process incoming payment' } }
  }, [serviceRegistry, refreshAll])

  /** Estimate Lightning fee for cross-mint swap (non-destructive) */
  const handleEstimateSwapFee = useCallback(async (
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
  ): Promise<{ fee: number; totalNeeded: number } | null> => {
    // Phase 5: SwapUseCase.estimateSwap() 경유
    if (!serviceRegistry?.swap) {
      console.warn('[MainApp] ServiceRegistry not ready — cannot estimate swap fee')
      return null
    }

    const result = await serviceRegistry.swap.estimateSwap({
      sourceAccountId: fromMintUrl,
      targetAccountId: toMintUrl,
      amount: sat(amount),
    })
    if (result.ok) {
      const fee = toNumber(result.value.fee)
      return { fee, totalNeeded: amount + fee }
    }
    return null
  }, [serviceRegistry])

  const handleEstimateRedeemFee = useCallback(async (
    token: string,
  ): Promise<{ grossAmount: number; fee: number; netAmount: number } | null> => {
    if (!serviceRegistry?.payment) return null
    const result = await serviceRegistry.payment.estimateRedeemFee({ input: token })
    if (result.ok) {
      return {
        grossAmount: toNumber(result.value.grossAmount),
        fee: toNumber(result.value.fee),
        netAmount: toNumber(result.value.netAmount),
      }
    }
    return null
  }, [serviceRegistry])

  const handleSwapReceive = useCallback(async (
    token: string,
    sourceMintUrl: string,
    targetMintUrl: string,
    amount: number,
  ): Promise<{ success: boolean; amount?: number; error?: BaseError }> => {
    if (!serviceRegistry?.payment || !serviceRegistry?.swap) {
      return { success: false, error: new ServiceNotReadyError('payment/swap') }
    }

    const redeemResult = await serviceRegistry.payment.redeem({ input: token })
    if (!redeemResult.ok) {
      return { success: false, error: redeemResult.error }
    }

    const swapResult = await serviceRegistry.swap.executeSwap({
      sourceAccountId: sourceMintUrl,
      targetAccountId: targetMintUrl,
      amount: sat(amount),
    })
    if (!swapResult.ok) {
      refreshAll().catch((e) => console.error('[MainApp] refreshAll after swap fail:', e))
      return { success: false, error: swapResult.error }
    }

    refreshAll().catch((e) => console.error('[MainApp] refreshAll after swap:', e))
    return { success: true, amount: toNumber(swapResult.value.amount) }
  }, [serviceRegistry, refreshAll])

  /** Cross-mint swap: execute swap from source mint to target mint */
  const handleMintSwap = useCallback(async (
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
  ): Promise<{ success: boolean; amount?: number; fee?: number; transactionId?: string } | null> => {
    if (!serviceRegistry?.swap) {
      console.warn('[MainApp] ServiceRegistry not ready — cannot perform swap')
      return null
    }

    const result = await serviceRegistry.swap.executeSwap({
      sourceAccountId: fromMintUrl,
      targetAccountId: toMintUrl,
      amount: sat(amount),
    })

    if (!result.ok) {
      addToast({ type: 'error', message: translateError(result.error, t), duration: 4000 })
      return null
    }

    refreshAll().catch((e) => console.error('[MainApp] refreshAll after swap:', e))
    return {
      success: true,
      amount: toNumber(result.value.amount),
      fee: toNumber(result.value.fee),
      transactionId: result.value.sendTxId,
    }
  }, [serviceRegistry, refreshAll, addToast, t])

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

  const clearIncomingReviewState = useCallback(() => {
    setActiveIncomingReview(null)
    setValidatedScanData(null)
  }, [])

  const handleResolveIncomingReview = useCallback(async (params: {
    review: PendingIncomingReview
    transactionId?: string
  }) => {
    if (!serviceRegistry) return

    await resolveIncomingReview({
      processedStore: serviceRegistry.processedStore,
      receiveRequest: serviceRegistry.receiveRequest,
      // durable 큐에서 제거 (설계 §6.2) — Zustand 미러는 큐 어댑터가 동기화
      removeIncomingReview: (externalId) =>
        serviceRegistry.incomingReviewQueue.remove(externalId),
      nostrGateway: serviceRegistry.nostrGateway,
      posDevices: settings.posDevices,
    }, params)

    // 신뢰 추가 경유 승인(설계 §6.3 [N3]): 같은 민트의 나머지 대기 review를
    // 자동 상환한다 — 민트 신뢰가 곧 승인. 모달의 자체 redeem이 끝난 뒤라
    // 활성 review와 race하지 않는다. 미신뢰 민트면 건너뜀(자동 폐기 방지).
    // mints는 store에서 최신을 읽는다 — "신뢰하고 받기" 흐름은 신뢰 추가와 이
    // 콜백이 같은 렌더 클로저 안에서 이어지므로 prop 캡처본은 신뢰 추가 이전
    // 값이다 (4단계 리뷰 #3).
    const reviewMint = normalizeMintUrl(params.review.token.mintUrl)
    const currentMints = useAppStore.getState().settings.mints
    if (currentMints.some((m) => isSameMintUrl(m, reviewMint))) {
      serviceRegistry.recoveryScheduler
        .drainReviewQueue(reviewMint)
        .catch((e) => console.warn('[App] review drain failed:', e))
    }
  }, [serviceRegistry, settings.posDevices])

  const handleRejectIncomingReview = useCallback(async (review: PendingIncomingReview) => {
    if (serviceRegistry) {
      await serviceRegistry.processedStore.save({
        externalId: review.externalId,
        processedAt: Date.now(),
        result: 'skipped',
        error: 'Rejected by user',
      })
      // durable 큐에서 제거 — 미제거 시 다음 부팅 hydrate에 부활한다 (설계 §6.2)
      await serviceRegistry.incomingReviewQueue.remove(review.externalId)
    } else {
      removeIncomingReview(review.externalId)
    }

    clearIncomingReviewState()
    setCurrentScreen(previousScreen || 'home')
    setPreviousScreen(null)
  }, [serviceRegistry, removeIncomingReview, clearIncomingReviewState, previousScreen])

  // Payment received callback
  // Lightning toast는 bridge.ts (mint-quote:redeemed)가 전역으로 담당
  const handlePaymentReceived = useCallback(async (
    _receivedAmount: number,
    _type: 'lightning' | 'ecash',
  ) => {
    refreshAll().catch((e) => console.error('[MainApp] refreshAll after payment received:', e))
    broadcastSync('balance_changed')
  }, [refreshAll])

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

  // Settings handlers
  const handleChangePassword = useCallback(async (oldPassword: string, newPassword: string): Promise<boolean> => {
    const result = await preUnlock.security.changePassword(oldPassword, newPassword)
    return result.isOk()
  }, [preUnlock.security])

  const handleVerifyPin = useCallback(async (pin: string): Promise<boolean> => {
    const result = await preUnlock.security.verifyPassword(pin)
    return result.isOk() && result.value
  }, [preUnlock.security])

  const handleBackupMnemonic = useCallback(async (password: string): Promise<string | null> => {
    const result = await preUnlock.security.getMnemonic(password)
    if (result.isOk()) {
      return result.value
    }
    return null
  }, [preUnlock.security])

  const handleLogout = useCallback(async (password: string): Promise<boolean> => {
    const result = await preUnlock.security.verifyPassword(password)
    // NO_WALLET = 과거 소거가 지갑 레코드 삭제 후 중단된 반쪽 상태(구버전 순서의
    // 유산) — 검증할 비밀이 없는데 잔존 데이터는 있다. wrongPin 으로 오도하는 대신
    // 소거를 재개시켜 탈출구를 준다 (Phase 1 이중 리뷰 처방).
    const isHalfWipedState = result.isErr() && result.error.code === 'NO_WALLET'
    if (!isHalfWipedState && !(result.isOk() && result.value)) {
      return false // PIN 오류 — SettingsScreen 이 wrongPin 표시
    }
    // 소거 실패는 throw 그대로 전파 — SettingsScreen 이 lock.errorOccurred 로
    // 표면화한다 (감사 Phase 1: 성공 가장 금지). 조각별 삭제는 wipeAccountData 로
    // 대체 — registry 부재 시에도 coco DB 를 포함해 전부 소거된다.
    await wipeAccountData({
      security: preUnlock.security,
      registry: serviceRegistry,
      removePasskey,
    })
    window.location.reload()
    return true
  }, [preUnlock.security, serviceRegistry])

  /** Profile republish — bootstrap의 profileService 경유 */
  const republishProfile = useCallback(async (mints: string[], relays: string[]) => {
    if (!serviceRegistry || !nostrPubkey || !p2pkPubkey) return
    try {
      await serviceRegistry.profile.publishAll(nostrPubkey, mints, relays, p2pkPubkey)
      console.log('[Profile] Republished successfully')
    } catch (e) {
      console.warn('[Profile] Failed to republish:', e)
    }
  }, [serviceRegistry, nostrPubkey, p2pkPubkey])

  const handleSaveSettings = useCallback(async (newSettings: Record<string, unknown>): Promise<void> => {
    const mergedSettings = { ...settings, ...newSettings }
    setSettings(mergedSettings)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await preUnlock.settingsRepo.saveSettings(mergedSettings as any)

    const newMints = newSettings.mints as string[] | undefined
    const newRelays = newSettings.relays as string[] | undefined
    // 집합 동등성 비교 (설계 §10 B6): 순서만 바뀐 relay 드래그 커밋마다 프로필
    // 3건(nutzap-info/relay-list/DM-relay-list)이 재발행되던 것을 생략한다 —
    // relay 이벤트는 집합 의미라 순서 변경은 재발행 사유가 아니다.
    // mints는 **순서 비교 유지** (6단계 리뷰 #2): 10019의 mint 목록 순서가
    // 수신 선호를 나타낼 수 있어 재정렬도 재발행 사유다.
    const sameSet = (a: string[], b: string[]) => {
      const sa = new Set(a)
      const sb = new Set(b)
      return sa.size === sb.size && [...sa].every((x) => sb.has(x))
    }
    const mintsChanged = newMints && JSON.stringify(newMints) !== JSON.stringify(settings.mints)
    const relaysChanged = newRelays && !sameSet(newRelays, settings.relays)

    if ((mintsChanged || relaysChanged) && p2pkPubkey) {
      republishProfile(newMints || settings.mints, newRelays || settings.relays)
    }
    // persistent 집합 재확립 (설계 §10 B3 — 6단계 리뷰 #1): relay 설정 변경은
    // 게이트웨이의 연결 대상도 갱신해야 한다. 레거시 경로는 다음 fetch의 암묵
    // connect가 처리했지만 컨트롤러 경로는 명시 호출이 유일한 확립 지점이다.
    if (relaysChanged && serviceRegistry) {
      const nextRelays = newRelays || settings.relays
      serviceRegistry.nostrGateway
        .connect([...new Set([...DEFAULT_RELAYS, ...nextRelays])])
        .catch((e) => console.warn('[App] relay reconnect failed:', e))
    }
    broadcastSync('settings_changed')
  }, [preUnlock.settingsRepo, settings, setSettings, p2pkPubkey, republishProfile, serviceRegistry])

  // Handle adding a trusted mint (from receive screen)
  const handleAddTrustedMint = useCallback(async (mintUrl: string): Promise<boolean> => {
    try {
      if (!serviceRegistry) {
        console.warn('[App] ServiceRegistry not ready — cannot add trusted mint')
        return false
      }

      const url = normalizeMintUrl(mintUrl)

      if (settings.mints.some((mint) => isSameMintUrl(mint, url))) {
        await serviceRegistry.trustMint(url)
        return true
      }

      // 직접 fetch → facade probe (설계 §5): 신뢰 추가는 "지금 유효한가" 검증이라
      // fresh probe — 응답은 metadata 캐시에 역주입되어 이후 화면들이 재사용한다
      const info = await serviceRegistry.mintInfo.getInfo(url, { fresh: true })
      if (!info || (!info.name && !info.pubkey)) {
        console.error('[App] Invalid or unreachable mint info')
        return false
      }

      const newMints = [...settings.mints, url]
      const newAliases = generateMintAliases(
        newMints,
        settings.mintAliases,
        (number) => t('mintDetail.defaultName', { number }),
      )
      const nextSettings = { ...settings, mints: newMints, mintAliases: newAliases }

      await preUnlock.settingsRepo.saveSettings(nextSettings)
      setSettings(nextSettings)

      try {
        await serviceRegistry.trustMint(url)
      } catch (trustError) {
        await preUnlock.settingsRepo.saveSettings(settings).catch((rollbackError) => {
          console.error('[App] Failed to rollback settings after mint trust failure:', rollbackError)
        })
        setSettings(settings)
        throw trustError
      }

      if (p2pkPubkey) {
        republishProfile(nextSettings.mints, nextSettings.relays)
      }

      // 시드 기반 잔액 복원 — 소유자 결정(설계 §6.3 편차): 재설치·재추가 사용자는
      // 이 민트에 잔액이 있었는지 알 수 없어 유실로 오인한다. 이 경로는 수신
      // 모달 도중이라 fire-and-forget — 완료 시 balance:changed가 화면을 갱신.
      serviceRegistry.payment
        .recoverAccounts({ accountIds: [url] })
        .catch((e) => console.warn('[App] Seed restore after trust failed:', e))

      console.log('[App] Added trusted mint:', url)
      broadcastSync('settings_changed')
      return true
    } catch (error) {
      console.error('[App] Failed to add trusted mint:', error)
      return false
    }
  }, [settings, preUnlock.settingsRepo, setSettings, p2pkPubkey, republishProfile, t, serviceRegistry])

  const handleSendRedirect = useCallback((validated: ValidatedData) => {
    setValidatedScanData(validated)
    setCurrentScreen('receive')
    addToast({ type: 'info', message: t('redirect.toReceive') })
  }, [addToast, t])

  const handleBack = useCallback(() => {
    const target = previousScreen || 'home'
    setPreviousScreen(null)
    setCurrentScreen(target)
    // 탭 화면으로 돌아가면 서브페이지 플래그 리셋 (엣지 스와이프 뒤로가기 대응)
    if (SCREEN_TO_TAB[target]) {
      setHasSettingsSubPage(false)
    }
  }, [previousScreen])

  // Android back button support via History API
  useEffect(() => {
    if (!window.history.state?.screen) {
      window.history.replaceState({ screen: 'home' }, '')
    }
  }, [])

  useEffect(() => {
    if (currentScreen === 'home') {
      window.history.replaceState({ screen: 'home' }, '')
    } else if (window.history.state?.screen !== currentScreen) {
      window.history.pushState({ screen: currentScreen }, '')
    }
  }, [currentScreen])

  const currentScreenRef = useRef(currentScreen)
  currentScreenRef.current = currentScreen
  const handleBackRef = useRef(handleBack)
  handleBackRef.current = handleBack

  useEffect(() => {
    const handlePopState = () => {
      if (currentScreenRef.current === 'home') {
        window.history.pushState({ screen: 'home' }, '')
      } else {
        handleBackRef.current()
      }
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

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
              {currentScreen === 'home' && (
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
              )}

              {currentScreen === 'settings' && (
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
              )}

              {/* Token flow: TokenScreen always rendered as base, TokenDetailScreen overlays with slide animation */}
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

              {currentScreen === 'token-easter-egg' && (
                <EasterEggScreen onClose={handleBack} />
              )}

              {currentScreen === 'contacts' && (
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
              )}

              {currentScreen === 'username-change' && (
                <UsernameChangeScreen
                  onBack={handleBack}
                  onSaveSettings={handleSaveSettings}
                />
              )}

              {currentScreen === 'history' && (
                <HistoryScreen
                  onBack={handleBack}
                  transactions={transactions}
                  initialMintUrls={historyInitialMintUrls}
                />
              )}

              {currentScreen === 'notifications' && (
                <NotificationsScreen
                  onBack={handleBack}
                  transactions={transactions}
                />
              )}

              {currentScreen === 'transfer' && (
                <TransferScreen
                  onBack={handleBack}
                  onTransactionComplete={refreshAll}
                  initialFromMintUrl={activeMintUrl ?? undefined}
                />
              )}

              {currentScreen === 'analytics' && (
                <AnalyticsScreen
                  onBack={handleBack}
                  transactions={transactions}
                />
              )}

              {currentScreen === 'add-mint' && (
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
              )}

              {currentScreen === 'mint-management' && (
                <MintManagementScreen
                  onBack={handleBack}
                  onAddMint={() => {
                    setPreviousScreen('mint-management')
                    setCurrentScreen('add-mint')
                  }}
                  onSaveSettings={handleSaveSettings}
                  onClearMintData={serviceRegistry ? (mintUrl) => serviceRegistry.cleanup.clearMintData(mintUrl) : undefined}
                />
              )}

              {currentScreen === 'relay-management' && (
                <RelayManagementScreen
                  onBack={handleBack}
                  onSaveSettings={handleSaveSettings}
                />
              )}

              {currentScreen === 'amount-action' && (
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
              )}

              {currentScreen === 'send' && (
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
              )}

              {currentScreen === 'token-create' && (
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
              )}

              {currentScreen === 'token-register' && (
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
              )}

              {currentScreen === 'receive' && (
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
              )}

              {currentScreen === 'transaction-detail' && selectedTransaction && (
                <TransactionDetailScreen
                  transaction={selectedTransaction}
                  onBack={() => {
                    setSelectedTransaction(null)
                    handleBack()
                  }}
                  mintUrls={settings.mints}
                />
              )}

              {currentScreen === 'mint-detail' && selectedMint && (
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
