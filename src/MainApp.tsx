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
import { setMintNameResolver, translateError } from '@/ui/utils/error-i18n'
import { broadcastSync, notifyKdfMigrated } from '@/utils/cross-tab-sync'
import { useAppStore } from '@/store'
import { useNetwork } from '@/ui/hooks/use-network'
import { useWallet } from '@/ui/hooks/use-wallet'
import { isSameMintUrl } from '@/utils/url'
import { AnimatePresence } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// Tier 1: Always loaded (critical path for authenticated users)
import { LoadingFallback } from '@/ui/components/common/LoadingFallback'
import { MainTabToolbar } from '@/ui/components/layout/TabToolbar'
import { AppStack } from '@/ui/navigation/stackflow'
import { PAYLOAD_DEPENDENT_PARENT } from '@/ui/navigation/types'
import { HomeScreen } from '@/ui/screens/Home/HomeScreen'
import { LockScreen } from '@/ui/screens/Lock/LockScreen'
import { EasterEggScreen } from '@/ui/screens/Token/EasterEggScreen'
import {
  Cog6ToothIcon as Cog6ToothIconOutline,
  IdentificationIcon as IdentificationIconOutline,
  WalletIcon as WalletIconOutline,
} from '@heroicons/react/24/outline'
import {
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
const PendingItemDetailScreen = lazy(() =>
  import('@/ui/screens/MintDetail/PendingItemDetailScreen').then((m) => ({ default: m.PendingItemDetailScreen })),
)
const RelayManagementScreen = lazy(() => import('@/ui/screens/Settings/RelayManagementScreen'))

import type { ValidatedData } from '@/core/domain/input-types'
import type { MintInfo } from '@/core/types'
import { ToastContainer } from '@/ui/components'
import { ReceiveFlow } from '@/ui/screens/Receive/ReceiveFlow'
import type { ReceiveLaunch } from '@/ui/screens/Receive/ReceiveFlow'
import { MyAddressScreen } from '@/ui/screens/MyAddress/MyAddressScreen'
import { SendFlow } from '@/ui/screens/Send/SendFlow'
import { routeValidatedInput } from '@/ui/utils/input-router'
import { QrScannerModal } from '@/ui/components/common/QrScannerModal'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { formatNpubShort } from '@/ui/screens/Send/sendDisplayHelpers'

// Services (via composition layer only)
import { createSecurityService } from '@/composition/security'
import type { UnlockResult } from '@/core/ports/driving/security.usecase'
import type { Transaction } from '@/core/domain/transaction'
import type { PendingItem } from '@/ui/hooks/usePendingItems'
import type { PendingIncomingReview } from '@/core/types'
import { removePasskey } from '@/ui/services/passkey'
import { resumeGraceOnBoot } from '@/ui/services/grace-boot'
import { isLockoutActive } from '@/ui/utils/lockout'
import { formatSats } from '@/utils/format'


// Register mint name resolver for error messages
setMintNameResolver((mintUrl) => {
  const state = useAppStore.getState()
  return state.settings.mintAliases?.[mintUrl] || null
})

/** Recovers a payload-less detail screen by redirecting to a safe parent on mount. */
function ScreenRedirect({ to, navigate }: { to: Screen; navigate: (screen: Screen) => void }) {
  useEffect(() => {
    navigate(to)
  }, [to, navigate])
  return <LoadingFallback />
}

export default function MainApp() {
  const { t } = useTranslation()
  const isLocked = useAppStore((state) => state.isLocked)
  const isInitializing = useAppStore((state) => state.isInitializing)
  const toasts = useAppStore((state) => state.toasts)
  const settings = useAppStore((state) => state.settings)
  const nostrPubkey = useAppStore((state) => state.nostrPubkey)
  const nostrPrivkey = useAppStore((state) => state.nostrPrivkey)
  const pendingIncomingReviews = useAppStore((state) => state.pendingIncomingReviews)
  const supportUnreadCount = useAppStore((state) => state.supportUnreadCount)

  const setLocked = useAppStore((state) => state.setLocked)
  const setInitializing = useAppStore((state) => state.setInitializing)
  const addToast = useAppStore((state) => state.addToast)
  const removeToast = useAppStore((state) => state.removeToast)

  const setFailedIncomingsCount = useAppStore((state) => state.setFailedIncomingsCount)
  const setNostrKeyPair = useAppStore((state) => state.setNostrKeyPair)
  const setP2pkPubkey = useAppStore((state) => state.setP2pkPubkey)
  const setSettings = useAppStore((state) => state.setSettings)

  // Service registry — created after bootstrap; null before unlock
  const [serviceRegistry, setServiceRegistry] = useState<BootstrapResult | null>(null)

  const { refreshBalance, balance } = useWallet()
  const { isOnline } = useNetwork()
  const [isRecovering, setIsRecovering] = useState(false)

  useCrossTabSync()
  useGlobalTokenClaimToast(serviceRegistry)
  useSupportNotifications(serviceRegistry)

  // Navigation state/logic — screen transitions, tab derivation, back, History API
  const {
    currentScreen,
    previousScreen,
    setCurrentScreen,
    replaceScreen,
    setPreviousScreen,
    activeTab,
    isTabScreen,
    setHasSettingsSubPage,
    handleTabSelect,
    handleBack,
  } = useAppNavigation()

  const navItems = useMemo(() => [
    {
      id: 'wallet',
      label: t('nav.wallet'),
      icon: <WalletIconOutline className="w-[20px] h-[20px]" />,
      activeIcon: <WalletIconSolid className="w-[20px] h-[20px]" />,
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

  const [selectedMint, setSelectedMint] = useState<MintInfo | null>(null)
  const [selectedMintIndex, setSelectedMintIndex] = useState(0)

  const [scannedAmount, setScannedAmount] = useState<number>(0)

  const [validatedScanData, setValidatedScanData] = useState<ValidatedData | null>(null)
  const [activeIncomingReview, setActiveIncomingReview] = useState<PendingIncomingReview | null>(null)

  const [receiveLaunch, setReceiveLaunch] = useState<ReceiveLaunch | null>(null)

  const [activeMintUrl, setActiveMintUrl] = useState<string | null>(null)

  const [historyInitialMintUrls, setHistoryInitialMintUrls] = useState<string[] | undefined>(undefined)

  const [contactInfo, setContactInfo] = useState<{ address: string; displayName: string } | null>(null)

  const [showHomeScanner, setShowHomeScanner] = useState(false)
  const [npubMintSelection, setNpubMintSelection] = useState<{
    validatedData: ValidatedData
    rawAddress: string
    commonMintUrls: string[]
  } | null>(null)

  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  // Home's mixed-in pending rows open the item detail as an overlay — pending
  // items are not transactions, so they never enter the tx-detail route.
  const [homePendingItem, setHomePendingItem] = useState<PendingItem | null>(null)


  // Pre-unlock services — needed to load settings/tx before unlock (via composition)
  const [preUnlock] = useState(() => ({
    security: createSecurityService(),
    ...createPreUnlockServices(),
  }))

  // Transaction history + atomic balance/tx refresh (the hook preserves refreshAll's atomicity contract)
  const { transactions, setTransactions, refreshAll } = useTransactions({
    serviceRegistry,
    fallbackRefreshBalance: refreshBalance,
    txRepo: preUnlock.txRepo,
  })

  /** Refresh balance/tx and run recovery in parallel (toast/refresh handled by the EventBus bridge) */
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
    // configured mint. Matches resolveCreateMint's selection rule.
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
    // (receive-redeem, amount-action, unsupported) destinations identically.
    const target = routeValidatedInput(validated)
    setContactInfo(null)
    switch (target.screen) {
      case 'send':
        setValidatedScanData(target.validatedData)
        setScannedAmount(0)
        setPreviousScreen(currentScreen)
        setCurrentScreen('send')
        return
      case 'receive-redeem':
        setReceiveLaunch({ redeemToken: target.token })
        setValidatedScanData(null)
        setPreviousScreen(currentScreen)
        setCurrentScreen('receive')
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
      case 'receive-redeem':
        setReceiveLaunch({ redeemToken: target.token })
        setValidatedScanData(null)
        setPreviousScreen(currentScreen)
        setCurrentScreen('receive')
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

  // Single-flight init: StrictMode/HMR invokes the effect twice, but boot work (the
  // grace resume in particular) must run exactly once. Both invocations share this
  // in-flight promise and setInitializing(false) waits on it, so LockScreen can't
  // flash mid-resume and let a PIN unlock overlap a pending bootstrap.
  const initPromiseRef = useRef<Promise<void> | null>(null)

  // Initialize app — Coco-independent work only (Coco inits after unlock in setupSubscription)
  useEffect(() => {
    const init = async () => {
      // Attempt grace resume FIRST — it only needs the blob (expiry is self-contained),
      // so it must not sit behind fallible settings/store loads: an earlier rejection
      // would otherwise strand a valid session on the PIN screen. An active lockout
      // skips resume and drops the blob (defense-in-depth). Resume failure degrades to
      // PIN. Note: a transient init error showing PIN while a valid blob persists is
      // accepted (conservative-safe, not a bypass) — the spec's LockScreen invariant
      // targets lock/lockout, and the spec is being amended by the controller.
      if (useAppStore.getState().isLocked) {
        try {
          await resumeGraceOnBoot({
            isLockoutActive,
            tryResumeSession: () => preUnlock.security.tryResumeSession(),
            clearGrace: () => preUnlock.security.clearGrace(),
            // Settings may not be loaded yet — the ?? 5 default T is acceptable; the
            // next heartbeat / timeout-change re-clamps grace to the real timeout.
            applyUnlock: (resumed) =>
              applyUnlockRef.current(resumed, useAppStore.getState().settings.autoLockTimeoutMinutes ?? 5),
          })
        } catch (e) {
          console.error('[Init] Grace resume failed:', e)
        }
      }

      // Fallible loads run after resume — their failure only degrades data freshness,
      // never the resume decision.
      try {
        const savedSettings = await preUnlock.settingsRepo.getSettings()
        setSettings(savedSettings)

        const failedItems = await preUnlock.failedIncomingStore.findAll()
        setFailedIncomingsCount(failedItems.length)

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
      }
    }

    // Reveal the UI only once the single shared init run settles.
    if (!initPromiseRef.current) {
      initPromiseRef.current = init()
    }
    initPromiseRef.current.finally(() => setInitializing(false))
    // setTransactions is a passthrough of useTransactions' useState setter — stable identity
  }, [preUnlock, setFailedIncomingsCount, setInitializing, setSettings, setTransactions])

  useEffect(() => {
    if (activeIncomingReview || pendingIncomingReviews.length === 0) return

    const nextReview = pendingIncomingReviews[0]
    setActiveIncomingReview(nextReview)
    // Clear any leftover launch so a stale redeemToken can't auto-open the
    // redeem sheet over this review's confirm step.
    setReceiveLaunch(null)
    setPreviousScreen(currentScreen === 'receive' ? previousScreen : currentScreen)
    // Push (not replace): replace overwrites the entry previousScreen returns to — from
    // Home it clears the only stack entry and strands the app on a cleared Receive with a
    // corrupted stack. The pushed entry may be skipped by iOS 16+ (no user activation), but
    // that is an accepted cosmetic quirk the jump-cut layer absorbs.
    setCurrentScreen('receive')
  }, [activeIncomingReview, pendingIncomingReviews, currentScreen, previousScreen, setCurrentScreen, setPreviousScreen])

  // Anchor check and state reconstruction — runs once when the app is unlocked
  // and has nostr keys.
  const anchorCheckedRef = useRef(false)
  useEffect(() => {
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
    if (isLocked || isInitializing || !serviceRegistry) return

    let cancelled = false

    const setupSubscription = async () => {
      // Coco init + observers + watchers + EventBus bridge (via composition root)
      try {
        await serviceRegistry.activate()
      } catch (e) {
        console.error('[Init] Failed to activate Coco:', e)
      }

      if (cancelled) return

      // Show balance immediately + run recovery in parallel
      await refreshAndRecover()
    }

    setupSubscription()

    // Visibility-change watcher — foreground/background transitions
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

  // Shared post-unlock wiring for BOTH the PIN path (handleUnlock) and the boot
  // grace-resume path — one function so the two can't drift. Persists grace here
  // (now + timeout) so a reload within the auto-lock window resumes without a PIN;
  // onboarding's createWallet deliberately does not run through here, so a first
  // run still reloads to PIN.
  // Single-flight guard: the boot resume and a LockScreen PIN/passkey unlock can both
  // reach applyUnlock in the mid-resume window (passkey auto-submits on mount). A
  // second concurrent run would double-bootstrap — skip it. The in-flight run still
  // unlocks the UI, so the skipped caller lands unlocked too.
  const applyingUnlockRef = useRef(false)
  const applyUnlock = useCallback(async (result: UnlockResult, timeoutMinutes: number): Promise<void> => {
    if (applyingUnlockRef.current) return
    applyingUnlockRef.current = true
    try {
      setNostrKeyPair(result.keys.publicKey, result.keys.privateKey)

      // KDF re-encryption migration just happened: reload other tabs (old bundle)
      // and clear the false lockout. Hoisted here so both success paths
      // (fast re-unlock, bootstrap) handle it at one point.
      if (result.migrated) {
        notifyKdfMigrated()
      }

      // Persist grace so a reload within the auto-lock window resumes without a PIN.
      // Awaited so a write failure is observed (logged), but wrapped so it never blocks
      // the unlock — the session is live regardless of whether the resume blob persisted.
      try {
        await preUnlock.security.saveGrace(Date.now() + timeoutMinutes * 60_000)
      } catch (e) {
        console.error('[Unlock] Grace save failed:', e)
      }

      // Lightweight unlock path: if the session (registry / socket / subscriptions)
      // is still alive, don't re-bootstrap — the mnemonic cache is restored and the
      // keys are the same wallet. A full reconnect on every unlock would revive, per
      // lock cycle, the burst the network rework removed.
      if (serviceRegistry) {
        setLocked(false)
        return
      }

      const registry = createBootstrap({
        nostrPrivateKeyHex: result.keys.privateKey,
        bip39Seed: result.bip39Seed,
      })
      // On re-unlock, dispose the previous registry generation's timers/subscriptions
      // (prevents flusher / TLS-polling leaks).
      setServiceRegistry((prev) => {
        prev?.dispose()
        return registry
      })

      setLocked(false)

      // Initialize CashuModule — fire-and-forget to avoid blocking the UI.
      // Refresh balance once SDK init completes (via BootstrapResult.refreshBalance).
      registry.cashuModule.initialize().then(() => {
        registry.refreshBalance().catch((e) => console.error('[Unlock] Post-init balance refresh failed:', e))
      }).catch((e) => console.error('[Unlock] CashuModule init failed:', e))

      // P2PK key — load in the background, don't block SDK init
      registry.p2pkKeyManager.getCurrentKey().then(({ pubkey }) => setP2pkPubkey(pubkey))
    } finally {
      applyingUnlockRef.current = false
    }
  }, [preUnlock.security, setLocked, setNostrKeyPair, setP2pkPubkey, serviceRegistry])

  const handleUnlock = useCallback(async (password: string): Promise<boolean> => {
    const result = await preUnlock.security.unlock(password)
    // false = PIN mismatch only (LockScreen counts it toward lockout). Infra
    // failures (UNLOCK_FAILED / NO_WALLET) throw instead, so they don't burn the
    // lockout counter and trap a legitimate user in brute-force defense —
    // LockScreen's catch shows lock.errorOccurred without counting it.
    if (!result.ok) {
      if (result.error.code === 'INVALID_PASSWORD') return false
      throw result.error
    }
    await applyUnlock(result.value, settings.autoLockTimeoutMinutes ?? 5)
    return true
  }, [preUnlock.security, applyUnlock, settings.autoLockTimeoutMinutes])

  // Latest applyUnlock in a ref so the boot init effect can resume without taking
  // applyUnlock as a dependency (which would re-run init on every unlock).
  const applyUnlockRef = useRef(applyUnlock)
  useEffect(() => {
    applyUnlockRef.current = applyUnlock
  }, [applyUnlock])

  // Security handlers (auto-lock / PIN change·verify / mnemonic backup / logout).
  // handleUnlock stays in MainApp — it's the bootstrap shim (registry generation
  // swap + composition wiring). wipeAccount bundles the composition wipe wiring
  // (wipeAccountData + registry + removePasskey) and injects it, so the hook
  // depends only on core ports.
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
    timeoutMinutes: settings.autoLockTimeoutMinutes ?? 5,
    isLocked,
    onLock: handleAutoLock,
    // Heartbeat + clamp: keep grace alive while active, and shrink it immediately
    // when the timeout setting is shortened.
    onExtendGrace: (expiresAt) =>
      preUnlock.security.extendGrace(expiresAt).catch((e) => console.error('[Grace] extend failed:', e)),
  })

  const clearIncomingReviewState = useCallback(() => {
    setActiveIncomingReview(null)
    setValidatedScanData(null)
  }, [])

  // Reset UI after a confirmed rejection — MainApp owns the review/scan params
  // and nav state (injected into the hook as a callback).
  const handleIncomingReviewRejected = useCallback(() => {
    clearIncomingReviewState()
    setReceiveLaunch(null)
    setCurrentScreen(previousScreen || 'home')
    setPreviousScreen(null)
  }, [clearIncomingReviewState, previousScreen, setCurrentScreen, setPreviousScreen])

  // Receive handlers (invoice / token redeem / request fulfillment / review
  // approve·reject / receive broadcast). resolveIncomingReview is a composition
  // function, so it's injected — the hook depends only on core ports.
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

  // Cross-mint swap handlers (swap/redeem fee estimate, redeem→swap receive, inter-mint swap)
  const {
    handleEstimateSwapFee,
    handleEstimateRedeemFee,
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

      if (result.ok) {
        refreshAll().catch((e) => console.error('[MainApp] refreshAll after route execution:', e))
        return result.value
      }

      console.error('[MainApp] Route execution failed:', result.error)
      addToast({ type: 'error', message: translateError(result.error, t), duration: 4000 })
      return null
    } catch (error) {
      console.error('[MainApp] handleExecuteRoute error:', error)
      return null
    }
  }, [serviceRegistry, refreshAll, addToast, t])

  const handleResolveRouteInvoice = useCallback(async (
    selection: RouteSelection,
    context: RouteContext,
  ): Promise<string | null> => {
    if (!serviceRegistry) return null
    const result = await serviceRegistry.resolveRouteInvoice(selection, context)
    if (!result.ok) {
      console.error('[MainApp] Route invoice resolution failed:', result.error)
      return null
    }
    return result.value
  }, [serviceRegistry])

  const handleCreateEcashToken = useCallback(async (amount: number, preferredMintUrl?: string, options?: { p2pkPubkey?: string; memo?: string }): Promise<{ token: string; txId: string; operationId: string } | null> => {
    if (isSendingEcashRef.current) return null
    if (!serviceRegistry?.transferLifecycle) {
      console.warn('[MainApp] ServiceRegistry not ready — cannot create ecash token')
      return null
    }
    isSendingEcashRef.current = true
    try {
      // TODO: P2PK locking condition still needs to be added to TransferIntent
      const txId = crypto.randomUUID()
      const transfer = await serviceRegistry.transferLifecycle.initiateTransfer(
        {
          txId,
          accountId: preferredMintUrl ?? '',
          amount: sat(amount),
          memo: options?.memo,
          // no recipient = token creation mode
        },
        'ecash'
      )

      // For ecash, prepare+execute complete synchronously; the created token
      // lands in transportRef.token.
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

  // ─── Fee estimate before token creation ───
  const handleEstimateCreateFee = useCallback(
    async (mintUrl: string, amount: number): Promise<{ fee: number; availableBalance: number } | null> => {
      if (!serviceRegistry?.payment || !serviceRegistry.balance) return null
      try {
        // Balance BEFORE the estimate: estimateFee's prepare→rollback reserves
        // proofs, and a read inside that window reports a transient dip.
        const balances = await serviceRegistry.balance.getByModule()
        const result = await serviceRegistry.payment.estimateFee({
          accountId: mintUrl,
          destination: '',
          amount: sat(amount),
        })
        if (!result.ok) return null
        const account = balances
          .flatMap((moduleBalance) => moduleBalance.accounts)
          .find((candidate) => isSameMintUrl(candidate.id, mintUrl))
        if (!account) return null
        return {
          fee: toNumber(result.value.fee),
          availableBalance: toNumber(account.amount),
        }
      } catch {
        return null
      }
    },
    [serviceRegistry],
  )

  // ─── Reclaim (receive) fee estimate — for an already-created tx ───
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

  // ─── Resolve a source mint for token creation (active-with-balance → any-with-balance → first) ───
  const resolveCreateMint = useCallback((): string => {
    if (activeMintUrl && (balance.byMint[activeMintUrl] ?? 0) > 0) return activeMintUrl
    const withBalance = settings.mints.find((url) => (balance.byMint[url] ?? 0) > 0)
    if (withBalance) return withBalance
    return activeMintUrl ?? settings.mints[0] ?? ''
  }, [activeMintUrl, balance, settings.mints])

  // ─── Reclaim an unclaimed created token ───
  const handleReclaimToken = useCallback(async (txId: string): Promise<void> => {
    if (!serviceRegistry?.reclaim?.reclaim) {
      addToast({ type: 'error', message: t('errors.serviceNotReady') })
      return
    }
    const result = await serviceRegistry.reclaim.reclaim(txId)
    if (result.ok) {
      addToast({ type: 'success', message: t('token.reclaim.success') })
    } else {
      const errorMessage = result.error ? translateError(result.error, t) : t('token.reclaim.failed')
      addToast({ type: 'error', message: errorMessage })
    }
  }, [serviceRegistry, addToast, t])

  // ─── Check whether the token being registered is a pending send I created ───
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

  // Mint/settings handlers (save settings + profile republish + add trusted mint).
  // republishProfile is used only by these two, so it's encapsulated in the hook.
  const { handleSaveSettings, handleAddTrustedMint } = useMintHandlers({
    serviceRegistry,
    settingsRepo: preUnlock.settingsRepo,
  })

  const handleSendRedirect = useCallback((validated: ValidatedData) => {
    setValidatedScanData(validated)
    // Same stale-launch guard as the home receive entry. The send launch is
    // cleared too — this leaves send without passing through onBack/onComplete.
    setReceiveLaunch(null)
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

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center h-full bg-background">
        <div className="text-center">
          <h1 className="text-title font-bold text-brand mb-4">ZAPPI</h1>
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  if (isLocked) {
    return (
      <LockScreen
        onUnlock={handleUnlock}
        onLockout={() => {
          // PIN lockout must invalidate grace so a relaunch can't resume without a PIN.
          preUnlock.security.clearGrace().catch((e) => console.error('[Lock] Grace clear on lockout failed:', e))
        }}
      />
    )
  }

  // Shared by mint detail and history — both open the same pending-item detail.
  const pendingItemCallbacks = serviceRegistry ? {
    onRedeemToken: async (tokenStr: string, itemId: string) => {
      const result = await serviceRegistry.payment.redeem({ input: tokenStr })
      if (result.ok) {
        // redeem() doesn't know about the offline-received record — drop it
        // here or the pending card survives its own redemption.
        const { DexieOfflineTokenStore } = await import('@/adapters/storage/dexie/dexie-offline-token-store')
        await new DexieOfflineTokenStore().bulkDelete([itemId]).catch(() => {})
      }
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
  } : undefined

  // ─── Screen route table ──────────────────────────────────────
  // Screen → render-fn map. Each render fn returns the JSX from the old
  // `{currentScreen === 'x' && (…)}` branch verbatim (pure move — no prop/structure
  // change). These are component-scope closures, so they capture the latest state
  // each render — do NOT wrap in useMemo (it would freeze a stale snapshot).
  //
  // Exceptions (rendered by renderStackScreen below):
  // - 'token-detail' has no screen anymore — stale sessions land on the
  //   PAYLOAD_DEPENDENT_PARENT replace-redirect ('history'). The activity stays
  //   registered so restored stacks can't crash (same rule as the 'token' stub).
  //
  // State guards (renders gated on state beyond currentScreen):
  // - 'transaction-detail': skipped if selectedTransaction is null — guard in render fn
  // - 'mint-detail': skipped if selectedMint is null — guard in render fn
  // Exhaustiveness is enforced via Record (not Partial): every Screen except the
  // Stackflow-rendered exception must appear here — a Partial would let a new
  // screen silently render blank. Missing/typo = compile error.
  const screenRoutes: Record<Exclude<Screen, 'token-detail'>, () => ReactNode> = {
    home: () => (
      <HomeScreen
        onTransactions={(mintUrl?: string) => {
          setHistoryInitialMintUrls(mintUrl ? [mintUrl] : undefined)
          setCurrentScreen('history')
        }}
        onProfile={() => {
          setPreviousScreen('home')
          setCurrentScreen('my-address')
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
          setContactInfo(null)
          setCurrentScreen('send')
        }}
        onReceive={(mintUrl) => {
          setPreviousScreen('home')
          setActiveMintUrl(mintUrl || null)
          setValidatedScanData(null)
          setScannedAmount(0)
          // Hardware/system back skips ReceiveFlow's onBack, so a stale launch
          // (e.g. a scanned redeem token) could survive — clear at clean entry.
          setReceiveLaunch(null)
          setCurrentScreen('receive')
        }}
        onSelectTransaction={(tx) => {
          setSelectedTransaction(tx)
          setPreviousScreen('home')
          setCurrentScreen('transaction-detail')
        }}
        onSelectPendingItem={setHomePendingItem}
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

    // Dismantled ecash tab — redirect stub for sessions restored on the old
    // activity (see Screen union comment in navigation/types.ts). Must replace,
    // not push: a push keeps Token underneath, so browser-back re-activates it
    // and re-fires the redirect forever.
    token: () => (
      <ScreenRedirect to="history" navigate={replaceScreen} />
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
        pendingItemCallbacks={pendingItemCallbacks}
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
          // Same stale-launch guard as the receive entry below.
          setPreviousScreen('amount-action')
          setCurrentScreen('send')
        }}
        onReceive={(amount) => {
          setScannedAmount(amount)
          setValidatedScanData(null)
          // Same stale-launch guard as the home receive entry.
          setReceiveLaunch(null)
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
        onResolveInvoice={handleResolveRouteInvoice}
        onMintSwap={handleMintSwap}
        onEstimateSwapFee={handleEstimateSwapFee}
        onRouteValidated={handleRouteValidated}
        validatedData={validatedScanData || undefined}
        initialAmount={scannedAmount || undefined}
        initialMintUrl={activeMintUrl}
        initialDestination={contactInfo?.address || undefined}
        initialDisplayName={contactInfo?.displayName || undefined}
        onRedirect={handleSendRedirect}
        onCreateToken={(amount, mintUrl, memo) => handleCreateEcashToken(amount, mintUrl, { memo })}
        onEstimateCreateFee={handleEstimateCreateFee}
        onQuoteReclaim={handleQuoteReclaim}
        onReclaimToken={handleReclaimToken}
        directMintUrl={resolveCreateMint()}
      />
    ),

    receive: () => (
      <ReceiveFlow
        onBack={() => {
          const backTo = previousScreen || 'home'
          clearIncomingReviewState()
          setReceiveLaunch(null)
          setPreviousScreen(null)
          setCurrentScreen(backTo)
        }}
        onComplete={() => {
          // Return where we came from (e.g. the token tab) like onBack does.
          const backTo = previousScreen || 'home'
          clearIncomingReviewState()
          setReceiveLaunch(null)
          setPreviousScreen(null)
          setCurrentScreen(backTo)
        }}
        onCreateInvoice={handleCreateInvoice}
        onPaymentReceived={handlePaymentReceived}
        onReceiveRequestFulfilled={handleReceiveRequestFulfillment}
        onReceiveToken={handleReceiveToken}
        onAddTrustedMint={handleAddTrustedMint}
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
        incomingReview={activeIncomingReview}
        onResolveIncomingReview={(params) =>
          activeIncomingReview
            ? handleResolveIncomingReview({ review: activeIncomingReview, transactionId: params.transactionId })
            : Promise.resolve()
        }
        onRejectIncomingReview={() =>
          activeIncomingReview ? handleRejectIncomingReview(activeIncomingReview) : Promise.resolve()
        }
        launch={receiveLaunch}
        initialAmount={scannedAmount || undefined}
        initialMintUrl={activeMintUrl}
      />
    ),

    'my-address': () => (
      <MyAddressScreen
        onBack={handleBack}
        onOpenSettings={() => {
          setPreviousScreen('my-address')
          setCurrentScreen('settings')
        }}
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
        onSend={(mintUrl) => {
          setPreviousScreen('mint-detail')
          setActiveMintUrl(mintUrl)
          setValidatedScanData(null)
          setScannedAmount(0)
          // Hardware back skips SendFlow's onBack, so a stale contact could survive.
          setContactInfo(null)
          setCurrentScreen('send')
        }}
        onReceive={(mintUrl) => {
          setPreviousScreen('mint-detail')
          setActiveMintUrl(mintUrl)
          setValidatedScanData(null)
          setScannedAmount(0)
          // Same clean-entry rule as home: a stale scanned-redeem launch must not survive.
          setReceiveLaunch(null)
          setCurrentScreen('receive')
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
        onFindTransaction={serviceRegistry ? (id: string) => serviceRegistry.transactionMgmt.getById(id) : undefined}
        pendingItemCallbacks={pendingItemCallbacks}
      />
    ),
  }


  const renderStackScreen = (screen: Screen): ReactNode => {
    const route = (screenRoutes as Partial<Record<Screen, () => ReactNode>>)[screen]
    if (route) {
      return <Suspense fallback={<LoadingFallback />}>{route()}</Suspense>
    }

    // A payload-dependent detail screen with no payload can only be reached by
    // deep-link/reload or a browser-forward into cleared state. Redirect to its safe
    // parent instead of stranding the user on a spinner. (Boot is also caught centrally
    // in the navigation store; this covers the post-mount forward-restore case.)
    const parent = PAYLOAD_DEPENDENT_PARENT[screen]
    if (parent) {
      return <ScreenRedirect to={parent} navigate={replaceScreen} />
    }

    return <LoadingFallback />
  }

  // Main app content
  const mainContent = (
    <>
      <div className="relative h-full overflow-hidden">
        <AppStack renderScreen={renderStackScreen} />
      </div>

      {/* Bottom Navigation */}
      <AnimatePresence mode="wait" initial={false}>
        {isTabScreen && (
          <MainTabToolbar
            key="main-tab-toolbar"
            navItems={navItems}
            activeTab={activeTab}
            onTabSelect={handleTabSelect}
            onScan={() => setShowHomeScanner(true)}
          />
        )}
      </AnimatePresence>

      {/* Home camera shortcut — top-right scan */}
      <QrScannerModal
        isOpen={showHomeScanner}
        onClose={() => setShowHomeScanner(false)}
        onScan={handleHomeScanResult}
      />

      {/* Home's pending-row detail — overlay, same screen the history block opens */}
      {homePendingItem && (
        <div className="fixed inset-0 z-[70] bg-background">
          <Suspense fallback={<LoadingFallback />}>
            <PendingItemDetailScreen
              item={homePendingItem}
              onBack={() => setHomePendingItem(null)}
              callbacks={pendingItemCallbacks}
              onItemRemoved={() => refreshAll()}
            />
          </Suspense>
        </div>
      )}

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

  if (serviceRegistry) {
    return (
      <ServiceProvider registry={serviceRegistry}>
        {mainContent}
      </ServiceProvider>
    )
  }

  return mainContent
}
