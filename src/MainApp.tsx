import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence } from 'motion/react'
import { useAppStore } from '@/store'
import { useWallet } from '@/hooks/use-wallet'
import { useNetwork } from '@/hooks/use-network'
import { useGiftWrapListener } from '@/hooks/useGiftWrapListener'
import { useCrossTabSync, broadcastSync } from '@/hooks/use-cross-tab-sync'
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
import { TransactionRepository } from '@/data/repositories/transaction.repository'
import { sendToken as cocoSendToken, getBalances as cocoGetBalances } from '@/coco/cashuService'
import { deleteCocoData, clearWalletCache } from '@/coco'
import { resetWalletCache } from '@/data/cache/wallet-cache'
import type { Transaction } from '@/core/types'
import { satUnit, formatSats } from '@/utils/format'
import { exchangeRateService } from '@/services/exchange-rate'

/** Sum all recovery counts into a single total */
function totalRecoveredCount(recovery: Awaited<ReturnType<PaymentService['recoverAll']>>): number {
  return recovery.quotes.recovered + recovery.melts.recovered + recovery.sendTokens.reclaimed + recovery.receivedTokens.redeemed
}

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
  const txRefreshTrigger = useAppStore((state) => state.txRefreshTrigger)

  // Store actions
  const setLocked = useAppStore((state) => state.setLocked)
  const setInitializing = useAppStore((state) => state.setInitializing)
  const addToast = useAppStore((state) => state.addToast)
  const removeToast = useAppStore((state) => state.removeToast)
  const setBalance = useAppStore((state) => state.setBalance)
  const setFailedSwapsCount = useAppStore((state) => state.setFailedSwapsCount)
  const setNostrKeyPair = useAppStore((state) => state.setNostrKeyPair)
  const setP2pkPubkey = useAppStore((state) => state.setP2pkPubkey)
  const setSettings = useAppStore((state) => state.setSettings)

  // Hooks
  const { refreshBalance } = useWallet()
  const { isOnline } = useNetwork()

  // State Reconstruction hook (ZAP-06)
  const { reconstruct, isRecovering } = useStateReconstruction()

  // Gift Wrap Listener - listens for NIP-17 DMs containing Cashu tokens (NUT-18 responses)
  // This runs when unlocked with nostr keys and settings loaded
  useGiftWrapListener()
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

  // Transaction detail state
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)

  // Services (initialized once)
  const [services] = useState(() => {
    const transactionRepo = new TransactionRepository()

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

  // Initialize app (wallet is guaranteed to exist when MainApp loads)
  useEffect(() => {
    const init = async () => {
      try {
        // Load settings from IndexedDB (secure storage)
        const savedSettings = await services.settingsRepo.getSettings()
        setSettings(savedSettings)

        // Load cached balance
        const cachedBalance = await services.wallet.getBalance()
        setBalance(cachedBalance)

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

        // Recover all pending operations (quotes, melts, send tokens)
        try {
          const recovery = await services.payment.recoverAll()
          const totalRecovered = totalRecoveredCount(recovery)
          if (totalRecovered > 0) {
            console.log(`Recovered: ${recovery.quotes.recovered} quotes, ${recovery.melts.recovered} melts, ${recovery.sendTokens.reclaimed} reclaimed, ${recovery.receivedTokens.redeemed} offline tokens`)
            const newBalance = await services.wallet.getBalance()
            setBalance(newBalance)
          }
        } catch (e) {
          console.error('Failed to recover pending operations:', e)
        }
      } catch (error) {
        console.error('Init error:', error)
      } finally {
        setInitializing(false)
      }
    }

    init()
  }, [services, setBalance, setFailedSwapsCount, setInitializing, setSettings])

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

  // WebSocket subscription for pending Lightning quotes (NUT-17)
  const wsSubscriptionRef = useRef<(() => void) | null>(null)
  const isSendingEcashRef = useRef(false)

  useEffect(() => {
    // Only subscribe when app is unlocked and initialized
    if (isLocked || isInitializing) return

    let cancelled = false

    const setupSubscription = async () => {
      // First, try to recover any pending operations
      try {
        const recovery = await services.payment.recoverAll()
        const totalRecovered = totalRecoveredCount(recovery)
        if (totalRecovered > 0) {
          console.log(`[Init] Recovered: ${recovery.quotes.recovered} quotes, ${recovery.melts.recovered} melts, ${recovery.sendTokens.reclaimed} reclaimed, ${recovery.receivedTokens.redeemed} offline tokens`)
          await refreshAll()
          if (recovery.quotes.recovered > 0) {
            addToast({
              type: 'success',
              message: t('toast.lightningArrived', { count: recovery.quotes.recovered }),
              duration: 4000,
            })
          }
          if (recovery.receivedTokens.redeemed > 0) {
            addToast({
              type: 'success',
              message: t('toast.offlineTokensRedeemed', { count: recovery.receivedTokens.redeemed }),
              duration: 4000,
            })
          }
        }
      } catch (e) {
        console.error('[Init] Failed to recover pending operations:', e)
      }

      if (cancelled) return

      // Subscribe to pending quotes via WebSocket (with polling fallback)
      try {
        const canceller = await services.payment.subscribeToPendingQuotes(
          async (mintUrl, _quoteId, amount) => {
            console.log(`[WSS] Payment received: ${satUnit()} ${amount} from ${mintUrl}`)
            await refreshAll()
            broadcastSync('balance_changed')
            addToast({
              type: 'success',
              message: t('toast.lightningReceived', { unit: satUnit(), amount: amount.toLocaleString() }),
              duration: 4000,
            })
          },
          (error) => {
            console.error('[WSS] Subscription error:', error)
          }
        )

        if (!cancelled) {
          wsSubscriptionRef.current = canceller
        } else {
          canceller()
        }
      } catch (e) {
        console.error('[WSS] Failed to setup subscription:', e)
      }
    }

    setupSubscription()

    // Visibility change handler - re-check when app comes to foreground
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        // Refresh exchange rates (throttled — no-op if recently fetched)
        exchangeRateService.refreshIfStale().catch(() => {})

        console.log('[Background] App visible, recovering pending operations')
        try {
          const recovery = await services.payment.recoverAll()
          const totalRecovered = totalRecoveredCount(recovery)
          if (totalRecovered > 0) {
            await refreshAll()
            broadcastSync('balance_changed')
            if (recovery.quotes.recovered > 0) {
              addToast({
                type: 'success',
                message: t('toast.lightningArrived', { count: recovery.quotes.recovered }),
                duration: 4000,
              })
            }
            if (recovery.receivedTokens.redeemed > 0) {
              addToast({
                type: 'success',
                message: t('toast.offlineTokensRedeemed', { count: recovery.receivedTokens.redeemed }),
                duration: 4000,
              })
            }
          }
        } catch (e) {
          console.error('[Background] Failed to recover pending operations:', e)
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      // Cancel WebSocket subscription
      if (wsSubscriptionRef.current) {
        wsSubscriptionRef.current()
        wsSubscriptionRef.current = null
      }
      // Disconnect all WebSockets
      services.payment.disconnectAllWebSockets()
    }
  }, [isLocked, isInitializing, services.payment, refreshAll, addToast, t])

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
      return {
        invoice: result.value.quote.request,
        quoteId: result.value.quote.quoteId,
        expiry: result.value.quote.expiry,
      }
    }
    return null
  }, [services.payment])

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
  const handlePaymentReceived = useCallback(async (
    receivedAmount: number,
    type: 'lightning' | 'ecash',
  ) => {
    refreshAll().catch((e) => console.error('[MainApp] refreshAll after payment received:', e))
    broadcastSync('balance_changed')

    // Show toast notification only for Lightning (Ecash has its own success screen)
    if (type === 'lightning') {
      addToast({
        type: 'success',
        message: t('toast.lightningPaymentComplete', { unit: satUnit(), amount: receivedAmount.toLocaleString() }),
        duration: 4000,
      })
    }
  }, [refreshAll, addToast, t])

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

  const handleCreateEcashToken = useCallback(async (amount: number, preferredMintUrl?: string, options?: { p2pkPubkey?: string; memo?: string }): Promise<string | null> => {
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

      const txId = `tx-ecash-send-${crypto.randomUUID()}`

      await services.payment.savePendingSendToken({
        id: txId,
        mintUrl,
        amount,
        createdAt: Date.now(),
      })

      const token = await cocoSendToken(mintUrl, amount, options)

      await services.payment.savePendingSendToken({
        id: txId,
        token,
        mintUrl,
        amount,
        createdAt: Date.now(),
      })

      const tx: Transaction = {
        id: txId,
        direction: 'send',
        type: 'ecash',
        amount,
        mintUrl,
        status: 'completed',
        createdAt: Date.now(),
        completedAt: Date.now(),
        memo: options?.memo,
        token,
      }
      await services.transactionRepo.save(tx)
      setTransactions((prev) => [tx, ...prev])

      await services.payment.removePendingSendToken(txId)

      await refreshBalance()

      broadcastSync('balance_changed')

      return token
    } catch (error) {
      console.error('Failed to create ecash token:', error)
      // InsufficientBalanceError는 호출자에게 전파하여 정확한 에러 메시지 표시
      if (error instanceof InsufficientBalanceError) throw error
      return null
    } finally {
      isSendingEcashRef.current = false
    }
  }, [services.transactionRepo, services.payment, refreshBalance])

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

    if ((mintsChanged || relaysChanged) && nostrPrivkey && nostrPubkey) {
      try {
        console.log('[Settings] Mints/relays changed, republishing kind:10019...')
        const publishResult = await services.profile.publishProfile(
          nostrPrivkey,
          newMints || settings.mints,
          nostrPubkey,
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
  }, [services.settingsRepo, services.profile, settings, setSettings, nostrPrivkey, nostrPubkey])

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

      if (nostrPrivkey && nostrPubkey && typeof services.profile.publishProfile === 'function') {
        try {
          console.log('[App] Re-publishing profile with updated mints...')
          const publishResult = await services.profile.publishProfile(
            nostrPrivkey,
            newMints,
            nostrPubkey,
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
  }, [settings, services.settingsRepo, services.profile, setSettings, nostrPrivkey, nostrPubkey])

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
          <h1 className="text-3xl font-bold mb-4">ZAPPI</h1>
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
          onTransactions={() => setCurrentScreen('history')}
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
          onSelectTransaction={(tx) => {
            setSelectedTransaction(tx)
            setPreviousScreen('history')
            setCurrentScreen('transaction-detail')
          }}
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
          onReceiveToken={handleReceiveToken}
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
          onSend={(mintUrl) => {
            setPreviousScreen('mint-detail')
            setSendInitialStep('input')
            setActiveMintUrl(mintUrl)
            setValidatedScanData(null)
            setScannedAmount(0)
            setCurrentScreen('send')
          }}
          onReceive={(mintUrl) => {
            setPreviousScreen('mint-detail')
            setActiveMintUrl(mintUrl)
            setValidatedScanData(null)
            setScannedAmount(0)
            setCurrentScreen('receive')
          }}
          onSwap={(mintUrl) => {
            setPreviousScreen('mint-detail')
            setActiveMintUrl(mintUrl)
            setCurrentScreen('transfer')
          }}
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
