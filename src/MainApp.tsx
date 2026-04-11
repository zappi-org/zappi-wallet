import { AppLifecycleWatcher } from '@/composition/app-lifecycle.watcher'
import { createBootstrap, type BootstrapResult, type RouteContext, type RouteExecutionResult, type RouteSelection } from '@/composition/bootstrap'
import { createPreUnlockServices } from '@/composition/pre-unlock'
import { LIMITS } from '@/core/constants'
import { sat, toNumber } from '@/core/domain/amount'
import { InsufficientBalanceError } from '@/core/errors/payment.errors'
import { ServiceProvider } from '@/ui/hooks/service-context'
import { broadcastSync } from '@/composition/cross-tab-sync'
import { useCrossTabSync } from '@/ui/hooks/use-cross-tab-sync'
// useMintHealth removed — mint health checks done via serviceRegistry directly
import { useNetwork } from '@/ui/hooks/use-network'
import { useWallet } from '@/ui/hooks/use-wallet'
import { useAppStore } from '@/store'
import { setMintNameResolver, toErrorMessage } from '@/ui/utils/error-message'
import { AnimatePresence } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

// Tier 1: Always loaded (critical path for authenticated users)
import { LoadingFallback } from '@/ui/components/common/LoadingFallback'
import { PageTransition } from '@/ui/components/common/PageTransition'
import { BottomNav } from '@/ui/components/layout/BottomNav'
import { HomeScreen } from '@/ui/screens/Home/HomeScreen'
import { LockScreen } from '@/ui/screens/Lock/LockScreen'
import { BookUser, Settings as SettingsIcon, Wallet } from 'lucide-react'

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
import type { MintInfo } from '@/core/types'
import { ToastContainer } from '@/ui/components'
import type { ValidatedData } from '@/core/domain/input-types'
import { ReceiveFlow } from '@/ui/screens/Receive/ReceiveFlow'
import { SendFlow } from '@/ui/screens/Send/SendFlow'

// Services (composition 경유만)
import { createSecurityService } from '@/composition/security'
import type { Transaction } from '@/core/domain/transaction'
import { removePasskey } from '@/ui/services/passkey'
import { formatSats } from '@/utils/format'


type Screen = 'home' | 'settings' | 'contacts' | 'history' | 'notifications' | 'transfer' | 'analytics' | 'add-mint' | 'mint-management' | 'relay-management' | 'amount-action' | 'send' | 'receive' | 'username-change' | 'transaction-detail' | 'mint-detail'

type TabId = 'wallet' | 'contacts' | 'settings'
const TAB_SCREENS: Record<TabId, Screen> = { wallet: 'home', contacts: 'contacts', settings: 'settings' }
const SCREEN_TO_TAB: Partial<Record<Screen, TabId>> = { home: 'wallet', contacts: 'contacts', settings: 'settings' }

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

  // Store actions
  const setLocked = useAppStore((state) => state.setLocked)
  const setInitializing = useAppStore((state) => state.setInitializing)
  const addToast = useAppStore((state) => state.addToast)
  const removeToast = useAppStore((state) => state.removeToast)

  const setFailedIncomingsCount = useAppStore((state) => state.setFailedIncomingsCount)
  const setNostrKeyPair = useAppStore((state) => state.setNostrKeyPair)
  const setP2pkPubkey = useAppStore((state) => state.setP2pkPubkey)
  const setSettings = useAppStore((state) => state.setSettings)
  const addPendingQuote = useAppStore((state) => state.addPendingQuote)

  // Service Registry (Phase 5: bootstrap 후 생성, unlock 전에는 null)
  const [serviceRegistry, setServiceRegistry] = useState<BootstrapResult | null>(null)

  // Hooks
  const { refreshBalance } = useWallet()
  const { isOnline } = useNetwork()
  const [isRecovering, setIsRecovering] = useState(false)

  // Gift Wrap Watcher — lifecycle managed via serviceRegistry
  useEffect(() => {
    if (!serviceRegistry) return
    serviceRegistry.giftWrapWatcher.start()
    return () => serviceRegistry.giftWrapWatcher.stop()
  }, [serviceRegistry])

  useCrossTabSync()

  // Local state
  const [currentScreen, setCurrentScreen] = useState<Screen>('home')
  const [previousScreen, setPreviousScreen] = useState<Screen | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  // Derive active tab from current screen
  const activeTab: TabId = SCREEN_TO_TAB[currentScreen] ?? 'wallet'

  // Bottom nav items
  const navItems = useMemo(() => [
    { id: 'wallet', label: t('nav.wallet'), icon: <Wallet className="w-[22px] h-[22px]" strokeWidth={1.6} /> },
    { id: 'contacts', label: t('nav.contacts'), icon: <BookUser className="w-[22px] h-[22px]" strokeWidth={1.6} /> },
    { id: 'settings', label: t('nav.settings'), icon: <SettingsIcon className="w-[22px] h-[22px]" strokeWidth={1.6} /> },
  ], [t])

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

  // Active mint from HomeScreen carousel
  const [activeMintUrl, setActiveMintUrl] = useState<string | null>(null)

  // History screen initial mint filter
  const [historyInitialMintUrls, setHistoryInitialMintUrls] = useState<string[] | undefined>(undefined)

  // Contact info for send flow (from address book)
  const [contactInfo, setContactInfo] = useState<{ address: string; displayName: string } | null>(null)

  // Transaction detail state
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)

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
    serviceRegistry.mintHealth.checkAllMints(settings.mints).catch(() => {})
    serviceRegistry.exchangeRate.refreshIfStale().catch(() => {})
  }, [serviceRegistry, refreshAndRecover, settings.mints])

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
        await preUnlock.exchangeRate.loadCachedRates().catch(() => {})
        preUnlock.exchangeRate.fetchRates()

        // Data retention: clean up old records
        preUnlock.txRepo.deleteOlderThan(90).catch(() => {})
        preUnlock.failedIncomingStore.cleanupNonRetryable(30).catch(() => {})
        preUnlock.cleanupExpiredReceiveRequests().catch(() => {})
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
          console.log(`[App] Recovered ${result.tokensReceived} tokens (${result.amountReceived} sats)`)
          await refreshAll()

          addToast({
            type: 'success',
            message: t('toast.ecashRecovered', { count: result.tokensReceived, amount: formatSats(result.amountReceived) }),
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

        // Phase 5: Bootstrap service registry (new path, coexists with old)
        const registry = createBootstrap({
          nostrPrivateKeyHex: result.value.keys.privateKey,
        })
        setServiceRegistry(registry)

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
  }, [preUnlock.security, setLocked, setNostrKeyPair, setP2pkPubkey])

  // Payment modal handlers
  const handleCreateInvoice = useCallback(async (amount: number, mintUrl: string) => {
    if (!mintUrl) return null

    // Phase 5: PaymentUseCase.receive() 경유
    if (!serviceRegistry?.payment) {
      console.warn('[MainApp] ServiceRegistry not ready — cannot create invoice')
      return null
    }

    const result = await serviceRegistry.payment.receive({
      accountId: mintUrl,
      protocol: 'bolt11',
      amount: sat(amount),
    })
    if (result.ok) {
      const req = result.value
      addPendingQuote({
        quoteId: req.id,
        mintUrl,
        amount,
        invoice: req.encoded,
        expiry: req.expiresAt ? req.expiresAt : Date.now() + 10 * 60 * 1000,
      })
      return {
        invoice: req.encoded,
        quoteId: req.id,
        expiry: req.expiresAt ? Math.floor(req.expiresAt / 1000) : Math.floor(Date.now() / 1000) + 600,
      }
    }
    return null
  }, [serviceRegistry, addPendingQuote])

  const handleReceiveToken = useCallback(async (token: string): Promise<{ success: boolean; amount?: number; transactionId?: string; error?: { code?: string; message?: string } }> => {
    // Phase 5: PaymentUseCase.redeem() 경유
    if (!serviceRegistry?.payment) {
      return { success: false, error: { code: 'NOT_READY', message: 'ServiceRegistry not ready' } }
    }

    const result = await serviceRegistry.payment.redeem({ input: token })
    if (result.ok) {
      refreshAll().catch((e) => console.error('[MainApp] refreshAll after receive failed:', e))
      return { success: true, amount: toNumber(result.value.amount), transactionId: result.value.requestId }
    }
    return { success: false, error: { code: result.error.code, message: result.error.message } }
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

  /** Estimate receive fee for a cashu token (input_fee_ppk) */
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
      addToast({ type: 'error', message: result.error.message, duration: 4000 })
      return null
    }

    refreshAll().catch((e) => console.error('[MainApp] refreshAll after swap:', e))
    return {
      success: true,
      amount: toNumber(result.value.amount),
      fee: toNumber(result.value.fee),
      transactionId: result.value.sendTxId,
    }
  }, [serviceRegistry, refreshAll, addToast])

  /** Cross-mint swap receive: receive token on source mint, then swap to target */
  const handleSwapReceive = useCallback(async (
    token: string,
    sourceMintUrl: string,
    targetMintUrl: string,
    amount: number,
  ): Promise<{ success: boolean; amount?: number; error?: { code?: string; message?: string } }> => {
    // Phase 5: redeem + SwapUseCase 경유
    if (!serviceRegistry?.payment || !serviceRegistry?.swap) {
      return { success: false, error: { code: 'NOT_READY', message: 'ServiceRegistry not ready' } }
    }

    // 1. Redeem token on source mint
    const redeemResult = await serviceRegistry.payment.redeem({ input: token })
    if (!redeemResult.ok) {
      return { success: false, error: { code: redeemResult.error.code, message: redeemResult.error.message } }
    }

    // 2. Swap from source to target
    const swapResult = await serviceRegistry.swap.executeSwap({
      sourceAccountId: sourceMintUrl,
      targetAccountId: targetMintUrl,
      amount: sat(amount),
    })
    if (!swapResult.ok) {
      refreshAll().catch((e) => console.error('[MainApp] refreshAll after swap fail:', e))
      return { success: false, error: { code: swapResult.error.code, message: swapResult.error.message } }
    }

    refreshAll().catch((e) => console.error('[MainApp] refreshAll after swap:', e))
    return { success: true, amount: toNumber(swapResult.value.amount) }
  }, [serviceRegistry, refreshAll])


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

  /** Store offline P2PK token for later redemption */
  const handleStoreOfflineToken = useCallback(async (
    token: string,
    amount: number,
    mintUrl: string,
    dleqStatus: 'valid' | 'missing',
  ): Promise<{ success: boolean }> => {
    if (!serviceRegistry) {
      console.warn('[MainApp] ServiceRegistry not ready — cannot store offline token')
      return { success: false }
    }
    try {
      await serviceRegistry.storeOfflineToken(token, amount, mintUrl, dleqStatus)
      return { success: true }
    } catch (error) {
      console.error('[App] Failed to store offline token:', error)
      return { success: false }
    }
  }, [serviceRegistry])

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
    if (!serviceRegistry?.payment) {
      console.warn('[MainApp] ServiceRegistry not ready — cannot create ecash token')
      return null
    }
    isSendingEcashRef.current = true
    try {
      // Phase 5: PaymentUseCase.send(destination없음 = 토큰 생성)
      // PaymentService가 내부적으로 민트 선택 + prepare/execute + TX 기록 전부 처리
      const accountId = preferredMintUrl ?? ''
      const result = await serviceRegistry.payment.send({
        accountId,
        amount: sat(amount),
        memo: options?.memo,
        options: options?.p2pkPubkey ? { lockingCondition: { type: 'p2pk', data: options.p2pkPubkey } } : undefined,
      })

      if (!result.ok) {
        console.error('Failed to create ecash token:', result.error.message)
        if (result.error.code === 'INSUFFICIENT_BALANCE') throw new InsufficientBalanceError(amount, 0)
        return null
      }

      const token = (result.value.data?.token as string) ?? ''
      const operationId = (result.value.data?.operationId as string) ?? ''
      const txId = result.value.transactionId

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

  // ─── NUT-18 전송 완료 콜백 ───
  const handleCompleteEcashSend = useCallback(async (txId: string) => {
    if (!serviceRegistry?.payment) {
      console.warn('[MainApp] ServiceRegistry not ready — cannot complete send')
      return
    }
    const result = await serviceRegistry.payment.completeSend({ transactionId: txId })
    if (!result.ok) {
      console.error('[MainApp] CompleteSend failed:', result.error.message)
    }
    setTransactions((prev) => prev.map((t) =>
      t.id === txId ? { ...t, status: 'settled' as const, outcome: 'claimed' as const, completedAt: Date.now() } : t
    ))
  }, [serviceRegistry])

  // ─── 토큰 취소(reclaim) 콜백 ───
  const handleCancelEcashToken = useCallback(async (txId: string) => {
    if (!serviceRegistry?.payment) {
      console.warn('[MainApp] ServiceRegistry not ready — cannot reclaim token')
      return
    }
    const result = await serviceRegistry.payment.reclaim({ transactionId: txId })
    if (!result.ok) {
      console.error('[MainApp] Reclaim failed:', result.error.message)
    }
  }, [serviceRegistry])

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
    if (result.isOk() && result.value) {
      await preUnlock.security.deleteWallet()
      await preUnlock.settingsRepo.clearAll()
      await preUnlock.txRepo.deleteAll()
      if (serviceRegistry) {
        await serviceRegistry.cleanup.deleteAllContacts()
        await serviceRegistry.cleanup.deleteCocoData()
        serviceRegistry.cleanup.clearWalletCache()
        serviceRegistry.cleanup.resetWalletCache()
      }
      removePasskey()

      useAppStore.getState().resetAll()

      window.location.reload()
      return true
    }
    return false
  }, [preUnlock.security, preUnlock.settingsRepo, preUnlock.txRepo, serviceRegistry])

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
    const mintsChanged = newMints && JSON.stringify(newMints) !== JSON.stringify(settings.mints)
    const relaysChanged = newRelays && JSON.stringify(newRelays) !== JSON.stringify(settings.relays)

    if ((mintsChanged || relaysChanged) && p2pkPubkey) {
      republishProfile(newMints || settings.mints, newRelays || settings.relays)
    }
    broadcastSync('settings_changed')
  }, [preUnlock.settingsRepo, settings, setSettings, p2pkPubkey, republishProfile])

  // Handle adding a trusted mint (from receive screen)
  const handleAddTrustedMint = useCallback(async (mintUrl: string): Promise<boolean> => {
    try {
      let url = mintUrl.trim()
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url
      }
      url = url.replace(/\/+$/, '')

      if (settings.mints.includes(url)) {
        return true
      }

      const infoResponse = await fetch(`${url}/v1/info`)
      if (!infoResponse.ok) {
        console.error('[App] Failed to fetch mint info:', infoResponse.status)
        return false
      }
      const info = await infoResponse.json()
      if (!info.name && !info.pubkey) {
        console.error('[App] Invalid mint info')
        return false
      }

      const newMints = [...settings.mints, url]
      const existingAliases = settings.mintAliases || {}
      const nextNumber = Object.keys(existingAliases).length + 1
      const alias = t('mintDetail.defaultName', { number: nextNumber })
      const newAliases = { ...existingAliases, [url]: alias }
      await preUnlock.settingsRepo.saveSettings({ ...settings, mints: newMints, mintAliases: newAliases })
      setSettings({ ...settings, mints: newMints, mintAliases: newAliases })

      if (p2pkPubkey) {
        republishProfile(newMints, settings.relays)
      }

      console.log('[App] Added trusted mint:', url)
      broadcastSync('settings_changed')
      return true
    } catch (error) {
      console.error('[App] Failed to add trusted mint:', error)
      return false
    }
  }, [settings, preUnlock.settingsRepo, setSettings, p2pkPubkey, republishProfile, t])

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
        <PageTransition key={currentScreen} variant="fade" className="absolute inset-0">
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
          onCreateEcashToken={handleCreateEcashToken}
          onCompleteEcashSend={handleCompleteEcashSend}
          onCancelEcashToken={handleCancelEcashToken}
          onMintSwap={handleMintSwap}
          onEstimateSwapFee={handleEstimateSwapFee}
          validatedData={validatedScanData || undefined}
          initialAmount={scannedAmount || undefined}
          initialMintUrl={activeMintUrl}
          initialDestination={contactInfo?.address || undefined}
          initialDisplayName={contactInfo?.displayName || undefined}
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
          onReceiveToken={handleReceiveToken}
          onAddTrustedMint={handleAddTrustedMint}
          onSwapReceive={handleSwapReceive}
          onEstimateSwapFee={handleEstimateSwapFee}
          onEstimateRedeemFee={handleEstimateRedeemFee}
          onStoreOfflineToken={handleStoreOfflineToken}
          onInspectInput={async (tokenStr: string) => {
            if (!serviceRegistry?.payment) return { lockStatus: 'not-supported' as const, proofIntegrity: 'not-supported' as const }
            const result = await serviceRegistry.payment.inspectInput({
              input: tokenStr,
              recipientPubkey: p2pkPubkey ?? undefined,
            })
            return result.ok ? result.value : { lockStatus: 'not-supported' as const, proofIntegrity: 'not-supported' as const }
          }}
          validatedData={validatedScanData || undefined}
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
          onDeleteMint={(url) => {
            if (settings.mints.length <= LIMITS.MIN_MINTS) {
              addToast({ type: 'warning', message: t('settings.minMintsRequired', { min: LIMITS.MIN_MINTS }) })
              return
            }
            const newMints = settings.mints.filter(m => m !== url)
            const { [url]: _, ...remainingAliases } = settings.mintAliases || {}
            setCurrentScreen('home')
            addToast({ type: 'success', message: t('mintDetail.mintDeleted') })
            handleSaveSettings({ mints: newMints, mintAliases: remainingAliases })
            serviceRegistry?.cleanup.clearMintData(url)
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
            onReclaimToken: async (itemId: string, operationId?: string, tokenStr?: string) => {
              return serviceRegistry.transactionMgmt.reclaimSendToken(itemId, operationId, tokenStr)
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
          } : undefined}
        />
      )}
          </Suspense>
        </PageTransition>
      </AnimatePresence>
      </div>

      {/* Bottom Navigation — slides in/out */}
      <BottomNav
        items={navItems}
        activeId={activeTab}
        visible={isTabScreen}
        onSelect={handleTabSelect}
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
