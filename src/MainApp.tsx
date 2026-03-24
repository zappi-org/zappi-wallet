import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence } from 'motion/react'
import { useAppStore } from '@/store'
import { useWallet } from '@/hooks/use-wallet'
import { useNetwork } from '@/hooks/use-network'
import { useMintHealth } from '@/hooks/use-mint-health'
import { useGiftWrapListener } from '@/hooks/useGiftWrapListener'
import { useCrossTabSync, broadcastSync } from '@/hooks/use-cross-tab-sync'
import { useSyncAfterRecovery, totalRecoveredCount } from '@/hooks/use-sync-after-recovery'
import { useStateReconstruction } from '@/hooks/useStateReconstruction'
import { checkAndRefreshAnchor } from '@/services/anchor'
import { getP2PKPubkey } from '@/services/crypto'
import { InsufficientBalanceError } from '@/core/errors/cashu'
import { translateError } from '@/core/errors/translate'
import { clearMintData } from '@/data/database/schema'

// Tier 1: Always loaded (critical path for authenticated users)
import { HomeScreen } from '@/ui/screens/Home/HomeScreen'
import { LockScreen } from '@/ui/screens/Lock/LockScreen'
import { LoadingFallback } from '@/ui/components/common/LoadingFallback'
import { PageTransition } from '@/ui/components/common/PageTransition'

// Tier 2: Lazy loaded (frequently used)
const SettingsScreen = lazy(() => import('@/ui/screens/Settings/SettingsScreen'))
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
import { SendFlow } from '@/ui/screens/Send/SendFlow'
import { ReceiveFlow } from '@/ui/screens/Receive/ReceiveFlow'
import type { ValidatedData } from '@/ui/components/scanner'
import { ToastContainer } from '@/ui/components'
import type { MintInfo } from '@/core/types'

// Services
import { removePasskey } from '@/services/passkey'
import { SecurityService } from '@/services/security/security.service'
import { WalletService } from '@/services/wallet/wallet.service'
import { PaymentService } from '@/services/payment/payment.service'
import { SyncService } from '@/services/sync/sync.service'
import { ProfileService } from '@/services/profile/profile.service'
import { SettingsRepository } from '@/data/repositories/settings.repository'
import { getTransactionRepo } from '@/data/repositories/transaction.repository'
import { getBalances as cocoGetBalances } from '@/coco/cashuService'
import { deleteCocoData, clearWalletCache, markSendFinalized, markSendReclaimed } from '@/coco'
import { resetWalletCache } from '@/data/cache/wallet-cache'
import type { Transaction } from '@/core/types'
import { satUnit, formatSats } from '@/utils/format'
import { exchangeRateService } from '@/services/exchange-rate'


type Screen = 'home' | 'settings' | 'history' | 'notifications' | 'transfer' | 'analytics' | 'add-mint' | 'mint-management' | 'relay-management' | 'amount-action' | 'send' | 'receive' | 'username-change' | 'transaction-detail' | 'mint-detail'

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

  const setFailedSwapsCount = useAppStore((state) => state.setFailedSwapsCount)
  const setNostrKeyPair = useAppStore((state) => state.setNostrKeyPair)
  const setP2pkPubkey = useAppStore((state) => state.setP2pkPubkey)
  const setSettings = useAppStore((state) => state.setSettings)
  const addPendingQuote = useAppStore((state) => state.addPendingQuote)

  // Hooks
  const { refreshBalance } = useWallet()
  const { isOnline } = useNetwork()
  const { checkAllMints } = useMintHealth()

  // State Reconstruction hook (ZAP-06)
  const { reconstruct, isRecovering } = useStateReconstruction()

  // Gift Wrap Listener - listens for NIP-17 DMs containing Cashu tokens (NUT-18 responses)
  // This runs when unlocked with nostr keys and settings loaded
  const { activateListening } = useGiftWrapListener()
  useCrossTabSync()

  // Local state
  const [currentScreen, setCurrentScreen] = useState<Screen>('home')
  const [previousScreen, setPreviousScreen] = useState<Screen | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])

  // MintDetail screen state
  const [selectedMint, setSelectedMint] = useState<MintInfo | null>(null)
  const [selectedMintIndex, setSelectedMintIndex] = useState(0)

  // Scanned amount state (for AmountActionScreen)
  const [scannedAmount, setScannedAmount] = useState<number>(0)
  const [scanMode, setScanMode] = useState<'send' | 'receive' | undefined>()

  // Validated scan data state (for unified payment screens)
  const [validatedScanData, setValidatedScanData] = useState<ValidatedData | null>(null)

  // Send flow initial step (for token-create from home)
  const [sendInitialStep, setSendInitialStep] = useState<'input' | 'token-create'>('input')

  // Active mint from HomeScreen carousel
  const [activeMintUrl, setActiveMintUrl] = useState<string | null>(null)

  // History screen initial mint filter
  const [historyInitialMintUrls, setHistoryInitialMintUrls] = useState<string[] | undefined>(undefined)

  // Transaction detail state
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)

  // Services (initialized once)
  const [services] = useState(() => {
    const transactionRepo = getTransactionRepo()

    // Inject fiat snapshot provider (avoids store coupling inside repository)
    transactionRepo.setFiatSnapshotProvider(() => {
      const state = useAppStore.getState()
      const currency = state.settings.fiatCurrency ?? 'USD'
      const show = state.settings.showFiatConversion ?? true
      const rate = state.allRates?.[currency] ?? null
      if (!show || !rate) return null
      return { fiatCurrency: currency, exchangeRate: rate }
    })

    return {
      security: new SecurityService(),
      wallet: new WalletService(),
      payment: new PaymentService(),
      sync: new SyncService(),
      profile: new ProfileService(),
      settingsRepo: new SettingsRepository(),
      transactionRepo,
    }
  })

  /** Refresh balance + transaction history in parallel */
  const refreshAll = useCallback(async () => {
    const [, txHistory] = await Promise.all([
      refreshBalance(),
      services.transactionRepo.findAll({ limit: 100 }),
    ])
    setTransactions(txHistory)
  }, [refreshBalance, services.transactionRepo])

  const { notifyRecovery, syncPendingQuotes, syncAfterRecovery } = useSyncAfterRecovery({ refreshAll })

  /** Manual pull-to-refresh handler */
  const handleManualRefresh = useCallback(async () => {
    // 1. 잔액/거래 로컬 갱신 + 네트워크 복구 병렬 실행
    const [, recoveryResult] = await Promise.all([
      refreshAll(),
      services.payment.recoverAll().catch((e) => {
        console.error('[Refresh] Failed to recover pending operations:', e)
        return null
      }),
    ])
    broadcastSync('balance_changed')

    // 2. 복구된 항목이 있으면 토스트 + 잔액 재갱신
    if (recoveryResult && totalRecoveredCount(recoveryResult) > 0) {
      notifyRecovery(recoveryResult)
      await refreshAll()
      broadcastSync('balance_changed')
    }

    // 3. Pending quotes 동기화
    await syncPendingQuotes()

    // 4. Pending quote 결제 상태 강제 재확인 (watcher cycle)
    import('@/coco/manager').then(({ recheckPendingMintQuotes }) =>
      recheckPendingMintQuotes().catch((e) => console.error('[Refresh] Failed to recheck pending quotes:', e))
    )

    // 5. 민트 상태 + 환율 (fire-and-forget)
    checkAllMints()
    exchangeRateService.refreshIfStale().catch(() => {})
  }, [services.payment, refreshAll, notifyRecovery, syncPendingQuotes, checkAllMints])

  // Initialize app — Coco 무관 작업만 (Coco는 unlock 후 setupSubscription에서 초기화)
  useEffect(() => {
    const init = async () => {
      try {
        // Load settings from IndexedDB (secure storage)
        const savedSettings = await services.settingsRepo.getSettings()
        setSettings(savedSettings)

        // Load failed swaps count
        const swaps = await services.sync.getFailedSwaps()
        setFailedSwapsCount(swaps.length)

        // Load transaction history
        const txHistory = await services.transactionRepo.findAll({ limit: 100 })
        setTransactions(txHistory)

        // Load cached exchange rates first, then fetch fresh in background
        await exchangeRateService.loadCachedRates().catch(() => {})
        exchangeRateService.fetchRates().catch(() => {})

        // Data retention: clean up old records
        services.transactionRepo.deleteOlderThan(90).catch(() => {})
        services.sync.cleanupOldData().catch(() => {})
      } catch (error) {
        console.error('Init error:', error)
      } finally {
        setInitializing(false)
      }
    }

    init()
  }, [services, setFailedSwapsCount, setInitializing, setSettings])

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
    if (isLocked || isInitializing || !nostrPubkey || !nostrPrivkey) return
    if (anchorCheckedRef.current) return

    anchorCheckedRef.current = true

    const runAnchorAndReconstruction = async () => {
      console.log('[App] Running anchor check and state reconstruction (ZAP-06)')

      try {
        // Step 1: Check and refresh anchor
        const { anchor, isRecoveryMode, oldestAnchor } = await checkAndRefreshAnchor()

        if (!anchor) {
          console.log('[App] No anchor available - skipping reconstruction')
          return
        }

        console.log(`[App] Anchor: ${new Date(anchor.timestamp * 1000).toISOString()}, Recovery mode: ${isRecoveryMode}`)

        // Step 2: Run state reconstruction to recover missed payments
        const result = await reconstruct(anchor, isRecoveryMode, oldestAnchor)

        if (result.tokensRecovered > 0) {
          console.log(`[App] Recovered ${result.tokensRecovered} tokens (${result.amountRecovered} sats)`)

          // Refresh balance and transactions
          await refreshAll()

          // Show toast notification
          addToast({
            type: 'success',
            message: t('toast.ecashRecovered', { count: result.tokensRecovered, amount: formatSats(result.amountRecovered) }),
            duration: 5000,
          })
        }
      } catch (error) {
        console.error('[App] Anchor/reconstruction error:', error)
      }
    }

    runAnchorAndReconstruction()
  }, [isLocked, isInitializing, nostrPubkey, nostrPrivkey, reconstruct, refreshAll, addToast, t])

  const isSendingEcashRef = useRef(false)

  useEffect(() => {
    // Only subscribe when app is unlocked and initialized
    if (isLocked || isInitializing) return

    let cancelled = false

    const setupSubscription = async () => {
      // Coco 초기화 (seed가 필요하므로 unlock 후에만 실행)
      // 1. Coco manager 초기화 + bridge 연결
      try {
        const { getCocoManager, enableWatchers } = await import('@/coco/manager')
        await getCocoManager()

        // 2. Watchers 활성화 (seed 준비됨)
        await enableWatchers()
      } catch (e) {
        console.error('[Init] Failed to initialize Coco:', e)
      }

      if (cancelled) return

      // 3. Balance 로드 + pending operations recovery
      let recovery = null
      try {
        recovery = await services.payment.recoverAll()
        const totalRecovered = totalRecoveredCount(recovery)
        if (totalRecovered > 0) {
          console.log(`[Init] Recovered: ${recovery.quotes.recovered} quotes, ${recovery.melts.recovered} melts, ${recovery.sendTokens.reclaimed} reclaimed, ${recovery.receivedTokens.redeemed} offline tokens`)
        }
      } catch (e) {
        console.error('[Init] Failed to recover pending operations:', e)
      }

      if (cancelled) return

      // 4. 잔액 + 거래내역 + pending quotes 동기화
      await syncAfterRecovery(recovery)
    }

    setupSubscription()

    // Visibility change handler - re-check when app comes to foreground
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        // Resume SDK subscriptions (WS reconnect + polling)
        try {
          const { getCocoManager, recheckPendingMintQuotes } = await import('@/coco/manager')
          const manager = await getCocoManager()
          manager.resumeSubscriptions()
          recheckPendingMintQuotes().catch((e) => console.error('[Background] Failed to recheck pending quotes:', e))
        } catch { /* ignore if not initialized */ }

        // Refresh exchange rates (throttled — no-op if recently fetched)
        exchangeRateService.refreshIfStale().catch(() => {})

        // Recovery + 잔액/pending quotes 동기화
        // (Coco watcher가 백그라운드에서 redeem했을 수 있으므로 recovery 결과와 무관하게 실행)
        console.log('[Background] App visible, recovering pending operations')
        let recovery = null
        try {
          recovery = await services.payment.recoverAll()
        } catch (e) {
          console.error('[Background] Failed to recover pending operations:', e)
        }

        await syncAfterRecovery(recovery)
      } else {
        // Pause SDK subscriptions (배터리 절약)
        try {
          const { getCocoManager } = await import('@/coco/manager')
          const manager = await getCocoManager()
          manager.pauseSubscriptions()
        } catch { /* ignore if not initialized */ }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      services.payment.disconnectAllWebSockets()
    }
  }, [isLocked, isInitializing, services.payment, syncAfterRecovery])

  // Handle unlock
  const handleUnlock = useCallback(async (password: string): Promise<boolean> => {
    try {
      const result = await services.security.unlock(password)
      if (result.isOk()) {
        // Set nostr key pair in store (for Coco seedGetter)
        setNostrKeyPair(result.value.publicKey, result.value.privateKey)
        setP2pkPubkey(getP2PKPubkey(result.value.privateKey))

        setLocked(false)
        // Refresh balance after unlock
        await refreshBalance()
        return true
      }
      return false
    } catch {
      return false
    }
  }, [services.security, setLocked, setNostrKeyPair, setP2pkPubkey, refreshBalance])

  // Handle validated scan data - route to appropriate screen based on type
  const handleValidatedScan = useCallback((data: ValidatedData, mode?: 'send' | 'receive') => {
    console.log('[App] Validated scan data:', data, 'mode:', mode)
    setValidatedScanData(data)

    switch (data.type) {
      case 'bolt11':
      case 'lightning-address':
      case 'lnurl-pay':
      case 'cashu-request':
        setSendInitialStep('input')
        setCurrentScreen('send')
        break

      case 'lnurl-withdraw':
        setCurrentScreen('receive')
        break

      case 'cashu-token':
        setCurrentScreen('receive')
        break

      case 'amount':
        setScannedAmount(data.amount)
        setScanMode(mode)
        setCurrentScreen('amount-action')
        break

      default:
        console.warn('[App] Unknown validated data type:', data)
    }
  }, [])

  // Payment modal handlers
  const handleCreateInvoice = useCallback(async (amount: number, mintUrl: string) => {
    if (!mintUrl) return null

    const result = await services.payment.createLightningInvoice(amount, mintUrl)
    if (result.isOk()) {
      const { quote } = result.value
      addPendingQuote({
        quoteId: quote.quoteId,
        mintUrl,
        amount,
        invoice: quote.request,
        expiry: quote.expiry * 1000,
      })
      return {
        invoice: quote.request,
        quoteId: quote.quoteId,
        expiry: quote.expiry,
      }
    }
    return null
  }, [services.payment, addPendingQuote])

  // Subscribe to quote — handles polling + WebSocket internally
  const handleSubscribeToQuote = useCallback(async (
    mintUrl: string,
    quoteId: string,
    amount: number,
    onPaid: () => void,
    onError?: (error: Error) => void
  ): Promise<(() => void) | null> => {
    if (!mintUrl) return null

    return services.payment.subscribeToQuote(
      mintUrl,
      quoteId,
      amount,
      async () => {
        refreshAll().catch((e) => console.error('[MainApp] refreshAll after quote paid:', e))
        onPaid()
      },
      onError
    )
  }, [services.payment, refreshAll])

  const handleReceiveToken = useCallback(async (token: string): Promise<{ success: boolean; amount?: number; transactionId?: string; error?: { code?: string; message?: string } }> => {
    const result = await services.payment.receiveEcash(token)
    if (result.isOk()) {
      // Token consumed — refresh is best-effort, must not mask success
      refreshAll().catch((e) => console.error('[MainApp] refreshAll after receive failed:', e))
      return { success: true, amount: result.value.amount, transactionId: result.value.transactionId }
    }
    const e = result.error
    return { success: false, error: { code: e.code, message: translateError(e) } }
  }, [services.payment, refreshAll])

  /** Estimate Lightning fee for cross-mint swap (non-destructive) */
  const handleEstimateSwapFee = useCallback(async (
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
  ): Promise<{ fee: number; totalNeeded: number } | null> => {
    try {
      return await services.payment.estimateSwapFee(fromMintUrl, toMintUrl, amount)
    } catch (error) {
      console.error('[MainApp] estimateSwapFee failed:', error)
      return null
    }
  }, [services.payment])

  /** Cross-mint swap receive: receive token on source mint, then swap to target */
  const handleSwapReceive = useCallback(async (
    token: string,
    sourceMintUrl: string,
    targetMintUrl: string,
    amount: number,
  ): Promise<{ success: boolean; amount?: number; error?: { code?: string; message?: string } }> => {
    // 1. Receive token on source mint (auto-registers in Coco)
    const receiveResult = await services.payment.receiveEcash(token)
    if (receiveResult.isErr()) {
      const e = receiveResult.error
      return { success: false, error: { code: e.code, message: translateError(e) } }
    }

    // 2. Swap from source to target mint via Lightning
    const swapResult = await services.payment.mintSwap(sourceMintUrl, targetMintUrl, amount)
    if (swapResult.isErr()) {
      // Token was received but swap failed — balance is on source mint
      // Refresh is best-effort so user can see the balance
      refreshAll().catch((e) => console.error('[MainApp] refreshAll after swap fail:', e))
      const e = swapResult.error
      return { success: false, error: { code: e.code, message: translateError(e) } }
    }

    // 3. Success — refresh is best-effort, must not mask success
    refreshAll().catch((e) => console.error('[MainApp] refreshAll after swap:', e))
    return { success: true, amount: swapResult.value.amount }
  }, [services.payment, refreshAll])

  /** Cross-mint swap for send flow: swap balance from source to target mint */
  const handleMintSwap = useCallback(async (
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
  ): Promise<{ success: boolean; amount?: number; error?: string }> => {
    const swapResult = await services.payment.mintSwap(fromMintUrl, toMintUrl, amount)
    if (swapResult.isErr()) {
      const e = swapResult.error
      return { success: false, error: translateError(e) }
    }
    refreshAll().catch((e) => console.error('[MainApp] refreshAll after send swap:', e))
    return { success: true, amount: swapResult.value.amount }
  }, [services.payment, refreshAll])

  /** Store offline P2PK token for later redemption */
  const handleStoreOfflineToken = useCallback(async (
    token: string,
    amount: number,
    mintUrl: string,
    dleqStatus: 'valid' | 'missing',
  ): Promise<{ success: boolean }> => {
    try {
      await services.payment.storeOfflineToken(token, amount, mintUrl, dleqStatus)
      return { success: true }
    } catch (error) {
      console.error('[App] Failed to store offline token:', error)
      return { success: false }
    }
  }, [services.payment])

  // Payment received callback
  // Lightning toast는 bridge.ts (mint-quote:redeemed)가 전역으로 담당
  const handlePaymentReceived = useCallback(async (
    _receivedAmount: number,
    _type: 'lightning' | 'ecash',
  ) => {
    refreshAll().catch((e) => console.error('[MainApp] refreshAll after payment received:', e))
    broadcastSync('balance_changed')
  }, [refreshAll])

  // Send modal handlers
  const handleSendLightning = useCallback(async (addressOrInvoice: string, amount: number, mintUrl?: string): Promise<boolean> => {
    const result = await services.payment.sendLightning(addressOrInvoice, amount, mintUrl)

    if (result.isErr()) {
      console.error('Lightning send failed:', result.error)
      addToast({
        type: 'error',
        message: translateError(result.error),
        duration: 4000,
      })
      return false
    }

    console.log('Lightning payment sent:', result.value)

    // Fire-and-forget so toast always shows
    refreshAll().catch((e) => console.error('[MainApp] refreshAll after lightning send:', e))

    addToast({
      type: 'success',
      message: t('toast.lightningSendComplete', { unit: satUnit(), amount: result.value.amount.toLocaleString(), feeUnit: satUnit(), fee: result.value.fee }),
      duration: 4000,
    })

    broadcastSync('balance_changed')

    return true
  }, [services.payment, refreshAll, addToast, t])

  const handleCreateEcashToken = useCallback(async (amount: number, preferredMintUrl?: string, options?: { p2pkPubkey?: string; memo?: string }): Promise<{ token: string; txId: string; operationId: string } | null> => {
    if (isSendingEcashRef.current) return null
    isSendingEcashRef.current = true
    try {
      const balances = await cocoGetBalances()

      let mintUrl: string

      if (preferredMintUrl && balances[preferredMintUrl] >= amount) {
        mintUrl = preferredMintUrl
      } else {
        const sufficientMints = Object.entries(balances)
          .filter(([, bal]) => bal >= amount)
          .sort(([, a], [, b]) => a - b)

        if (sufficientMints.length === 0) {
          console.error('No mint has sufficient balance for', amount)
          return null
        }

        mintUrl = sufficientMints[0][0]
      }

      // SDK SendApi: prepare → execute
      const { prepareSendToken, executeSendToken } = await import('@/coco/cashuService')
      const { operationId } = await prepareSendToken(mintUrl, amount)
      const { token } = await executeSendToken(operationId, options)

      const txId = `tx-ecash-send-${crypto.randomUUID()}`

      const tx: Transaction = {
        id: txId,
        direction: 'send',
        type: 'ecash-token',
        amount,
        mintUrl,
        status: 'pending',
        createdAt: Date.now(),
        memo: options?.memo,
        token,
        tokenState: 'unspent',
        operationId,
      }
      await services.transactionRepo.save(tx)
      setTransactions((prev) => [tx, ...prev])

      // pendingSendToken 저장 (crash recovery용)
      await services.payment.savePendingSendToken({
        id: txId,
        token,
        mintUrl,
        amount,
        operationId,
        createdAt: Date.now(),
      })

      await refreshBalance()
      broadcastSync('balance_changed')

      // SDK ProofStateWatcher가 자동으로 proof 상태 감시
      // → send:finalized → sendTokenObserver가 Transaction 상태 업데이트

      return { token, txId, operationId }
    } catch (error) {
      console.error('Failed to create ecash token:', error)
      if (error instanceof InsufficientBalanceError) throw error
      return null
    } finally {
      isSendingEcashRef.current = false
    }
  }, [services.transactionRepo, services.payment, refreshBalance])

  // ─── NUT-18 전송 완료 콜백 ───
  const handleCompleteEcashSend = useCallback(async (txId: string) => {
    const tx = await services.transactionRepo.findById(txId)
    if (tx?.operationId) {
      const { getCocoManager } = await import('@/coco/manager')
      const manager = await getCocoManager()
      await manager.send.finalize(tx.operationId)
    }
    // SDK/레거시 공통: 공유 함수로 DB 상태 전이
    await markSendFinalized(txId)
    setTransactions((prev) => prev.map((t) =>
      t.id === txId ? { ...t, status: 'completed' as const, tokenState: 'spent' as const, completedAt: Date.now() } : t
    ))
  }, [services.transactionRepo])

  // ─── 토큰 취소(reclaim) 콜백 ───
  const handleCancelEcashToken = useCallback(async (txId: string) => {
    const tx = await services.transactionRepo.findById(txId)
    if (tx?.operationId) {
      const { rollbackSendToken } = await import('@/coco/cashuService')
      await rollbackSendToken(tx.operationId)
    }
    // SDK/레거시 공통: 공유 함수로 DB 상태 전이 (회수 receive 거래도 자동 생성됨)
    await markSendReclaimed(txId)
  }, [services.transactionRepo])

  // Settings handlers
  const handleChangePassword = useCallback(async (oldPassword: string, newPassword: string): Promise<boolean> => {
    const result = await services.security.changePassword(oldPassword, newPassword)
    return result.isOk()
  }, [services.security])

  const handleVerifyPin = useCallback(async (pin: string): Promise<boolean> => {
    const result = await services.security.verifyPassword(pin)
    return result.isOk() && result.value
  }, [services.security])

  const handleBackupMnemonic = useCallback(async (password: string): Promise<string | null> => {
    const result = await services.security.getMnemonic(password)
    if (result.isOk()) {
      return result.value
    }
    return null
  }, [services.security])

  const handleLogout = useCallback(async (password: string): Promise<boolean> => {
    const result = await services.security.verifyPassword(password)
    if (result.isOk() && result.value) {
      await services.security.deleteWallet()
      await services.settingsRepo.clearAll()
      await services.transactionRepo.deleteAll()
      await deleteCocoData()
      removePasskey()

      clearWalletCache()
      resetWalletCache()

      useAppStore.getState().resetAll()

      window.location.reload()
      return true
    }
    return false
  }, [services.security, services.settingsRepo, services.transactionRepo])

  const handleSaveSettings = useCallback(async (newSettings: Record<string, unknown>): Promise<void> => {
    const mergedSettings = { ...settings, ...newSettings }
    setSettings(mergedSettings)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await services.settingsRepo.saveSettings(mergedSettings as any)

    const newMints = newSettings.mints as string[] | undefined
    const newRelays = newSettings.relays as string[] | undefined
    const mintsChanged = newMints && JSON.stringify(newMints) !== JSON.stringify(settings.mints)
    const relaysChanged = newRelays && JSON.stringify(newRelays) !== JSON.stringify(settings.relays)

    if ((mintsChanged || relaysChanged) && nostrPrivkey && p2pkPubkey) {
      try {
        console.log('[Settings] Mints/relays changed, republishing kind:10019...')
        const publishResult = await services.profile.publishProfile(
          nostrPrivkey,
          newMints || settings.mints,
          p2pkPubkey,
          newRelays || settings.relays
        )
        if (publishResult.isOk()) {
          console.log('[Settings] Profile republished successfully')
        } else {
          console.warn('[Settings] Failed to republish profile:', publishResult.error)
        }
      } catch (e) {
        console.warn('[Settings] Failed to republish profile:', e)
      }
    }
    broadcastSync('settings_changed')
  }, [services.settingsRepo, services.profile, settings, setSettings, nostrPrivkey, p2pkPubkey])

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
      await services.settingsRepo.saveSettings({ ...settings, mints: newMints })
      setSettings({ ...settings, mints: newMints })

      if (nostrPrivkey && p2pkPubkey && typeof services.profile.publishProfile === 'function') {
        try {
          console.log('[App] Re-publishing profile with updated mints...')
          const publishResult = await services.profile.publishProfile(
            nostrPrivkey,
            newMints,
            p2pkPubkey,
            settings.relays
          )
          if (publishResult.isOk()) {
            console.log('[App] Profile republished successfully')
          } else {
            console.warn('[App] Failed to republish profile:', publishResult.error)
          }
        } catch (e) {
          console.warn('[App] Failed to republish profile:', e)
        }
      }

      console.log('[App] Added trusted mint:', url)
      broadcastSync('settings_changed')
      return true
    } catch (error) {
      console.error('[App] Failed to add trusted mint:', error)
      return false
    }
  }, [settings, services.settingsRepo, services.profile, setSettings, nostrPrivkey, p2pkPubkey])

  const handleBack = useCallback(() => {
    const target = previousScreen || 'home'
    setPreviousScreen(null)
    setCurrentScreen(target)
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
          <h1 className="text-title text-brand mb-4">ZAPPI</h1>
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  // Lock screen
  if (isLocked) {
    return <LockScreen onUnlock={handleUnlock} />
  }

  // Main app
  return (
    <>
      <div className="relative h-dvh overflow-hidden">
      <AnimatePresence mode="sync">
        <PageTransition key={currentScreen} variant="fade" className="absolute inset-0">
          <Suspense fallback={<LoadingFallback />}>
      {currentScreen === 'home' && (
        <HomeScreen
          onSettings={() => setCurrentScreen('settings')}
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
          onValidatedScan={handleValidatedScan}
          onSend={(mintUrl) => {
            setPreviousScreen('home')
            setSendInitialStep('input')
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
          onCreateToken={(mintUrl) => {
            setPreviousScreen('home')
            setSendInitialStep('token-create')
            setActiveMintUrl(mintUrl || null)
            setValidatedScanData(null)
            setScannedAmount(0)
            setCurrentScreen('send')
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
          onBack={handleBack}
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
          mode={scanMode}
          onBack={handleBack}
          onSend={(amount) => {
            setScannedAmount(amount)
            setValidatedScanData(null)
            setSendInitialStep('input')
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
            setCurrentScreen(backTo)
          }}
          onComplete={() => {
            setPreviousScreen(null)
            setCurrentScreen('home')
          }}
          onSendLightning={handleSendLightning}
          onCreateEcashToken={handleCreateEcashToken}
          onCompleteEcashSend={handleCompleteEcashSend}
          onCancelEcashToken={handleCancelEcashToken}
          onMintSwap={handleMintSwap}
          validatedData={validatedScanData || undefined}
          initialAmount={scannedAmount || undefined}
          initialMintUrl={activeMintUrl}
          initialStep={sendInitialStep}
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
          onSubscribeToQuote={handleSubscribeToQuote}
          onPaymentReceived={handlePaymentReceived}
          onReceiveToken={handleReceiveToken}
          onAddTrustedMint={handleAddTrustedMint}
          onSwapReceive={handleSwapReceive}
          onEstimateSwapFee={handleEstimateSwapFee}
          onStoreOfflineToken={handleStoreOfflineToken}
          onActivateListening={activateListening}
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
            setSendInitialStep('token-create')
            setActiveMintUrl(mintUrl)
            setValidatedScanData(null)
            setScannedAmount(0)
            setCurrentScreen('send')
          }}
          onDeleteMint={(url) => {
            const newMints = settings.mints.filter(m => m !== url)
            const { [url]: _, ...remainingAliases } = settings.mintAliases || {}
            setCurrentScreen('home')
            addToast({ type: 'success', message: t('mintDetail.mintDeleted') })
            handleSaveSettings({ mints: newMints, mintAliases: remainingAliases })
            clearMintData(url)
          }}
          onRenameMint={(url, newName) => {
            const newAliases = { ...settings.mintAliases, [url]: newName }
            handleSaveSettings({ mintAliases: newAliases })
            if (selectedMint && selectedMint.url === url) {
              setSelectedMint({ ...selectedMint, alias: newName, name: newName })
            }
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
        />
      )}
          </Suspense>
        </PageTransition>
      </AnimatePresence>
      </div>

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </>
  )
}
