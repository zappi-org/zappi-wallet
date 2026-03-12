import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { ArrowLeft, Zap, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/common'
import { MintCard, getVariantByIndex } from '../../components/wallet/MintCard'
import { cn } from '@/components/ui/utils'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { useMintHealth } from '@/hooks/use-mint-health'
import type { MintInfo } from '@/core/types'
import { normalizeMintUrl } from '@/utils/url'
import { NostrService } from '@/services/nostr/nostr.service'
import { ZappiLinkService, type ServerDefaults } from '@/services/zappi-link'
import { PaymentService } from '@/services/payment/payment.service'
import { TransactionRepository } from '@/data/repositories/transaction.repository'
import { sendToken } from '@/coco'
import { BaseError } from '@/core/errors/base'
import { translateError } from '@/core/errors/translate'
import { ZAPPI_LINK_DOMAIN } from '@/core/constants'

const USERNAME_REGEX = /^[a-z0-9]{3,20}$/

export interface UsernameChangeScreenProps {
  onBack: () => void
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
}

export function UsernameChangeScreen({ onBack, onSaveSettings }: UsernameChangeScreenProps) {
  const { t } = useTranslation()

  const settings = useAppStore((state) => state.settings)
  const nostrPrivkey = useAppStore((state) => state.nostrPrivkey)
  const balanceByMint = useAppStore((state) => state.balance.byMint)
  const addToast = useAppStore((state) => state.addToast)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const triggerTxRefresh = useAppStore((state) => state.triggerTxRefresh)

  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)
  const { getCachedStatus } = useMintHealth()

  const [services] = useState(() => ({
    nostr: new NostrService(),
    payment: new PaymentService(),
  }))
  const zappiLinkService = useMemo(
    () => new ZappiLinkService(services.nostr),
    [services.nostr]
  )

  // Username validation
  const [newUsername, setNewUsername] = useState('')
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [usernameError, setUsernameError] = useState('')
  const [isCheckingUsername, setIsCheckingUsername] = useState(false)
  const [serverDefaults, setServerDefaults] = useState<ServerDefaults | null>(null)
  const serverDefaultsRef = useRef<ServerDefaults | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mint selection
  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(null)

  // Payment
  const [isChanging, setIsChanging] = useState(false)
  const prevAddressRef = useRef(settings.lightningAddress || '-')

  // --- Auto-select best mint ---
  const autoSelectMint = useCallback((defaults: ServerDefaults) => {
    const fee = defaults.addressFee
    const mintEntries = Object.entries(balanceByMint)
      .map(([url, balance]) => ({ url, balance }))
      .filter(({ balance }) => balance > 0)

    const accepted: typeof mintEntries = []
    const nonAccepted: typeof mintEntries = []

    for (const entry of mintEntries) {
      const isAccepted = defaults.acceptedMints.some(
        (am) => normalizeMintUrl(am) === normalizeMintUrl(entry.url)
      )
      if (isAccepted) {
        accepted.push(entry)
      } else {
        nonAccepted.push(entry)
      }
    }

    // Prefer accepted mints with sufficient balance
    const bestAccepted = accepted.find((m) => m.balance >= fee)
    if (bestAccepted) {
      setSelectedMintUrl(bestAccepted.url)
      return
    }

    // Fallback to non-accepted mints with sufficient balance
    const bestNonAccepted = nonAccepted.find((m) => m.balance >= fee)
    if (bestNonAccepted) {
      setSelectedMintUrl(bestNonAccepted.url)
      return
    }

    // Select any mint with the highest balance
    const allSorted = mintEntries.sort((a, b) => b.balance - a.balance)
    if (allSorted.length > 0) {
      setSelectedMintUrl(allSorted[0].url)
    }
  }, [balanceByMint])

  // --- Debounced username check ---
  useEffect(() => {
    setUsernameAvailable(null)
    setUsernameError('')
    if (!newUsername) return

    if (!USERNAME_REGEX.test(newUsername)) {
      setUsernameError(t('settings.usernameInvalid'))
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)

    debounceRef.current = setTimeout(async () => {
      setIsCheckingUsername(true)
      try {
        const result = await zappiLinkService.checkUsername(newUsername)
        if (result.isErr()) {
          setUsernameError(t('settings.usernameChangeFailed'))
          return
        }

        if (!result.value.available) {
          setUsernameAvailable(false)
          setUsernameError(
            result.value.reason === 'reserved'
              ? t('settings.usernameInvalid')
              : t('settings.usernameTaken')
          )
          return
        }

        setUsernameAvailable(true)

        // Fetch server defaults for fee info (via ref to avoid dependency loop)
        if (!serverDefaultsRef.current) {
          const defaultsResult = await zappiLinkService.getDefaults()
          if (defaultsResult.isOk()) {
            serverDefaultsRef.current = defaultsResult.value
            setServerDefaults(defaultsResult.value)
            autoSelectMint(defaultsResult.value)
          } else {
            setUsernameAvailable(false)
            setUsernameError(t('settings.usernameChangeFailed'))
          }
        } else {
          autoSelectMint(serverDefaultsRef.current)
        }
      } finally {
        setIsCheckingUsername(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [newUsername, zappiLinkService, t, autoSelectMint])

  // --- Derived: affordability ---
  const addressFee = serverDefaults?.addressFee ?? 0
  const isAcceptedMint =
    selectedMintUrl && serverDefaults
      ? serverDefaults.acceptedMints.some(
          (am) => normalizeMintUrl(am) === normalizeMintUrl(selectedMintUrl)
        )
      : false
  const selectedBalance = selectedMintUrl ? (balanceByMint[selectedMintUrl] ?? 0) : 0
  const canAfford = selectedMintUrl ? selectedBalance >= addressFee : false

  // --- All mints with sufficient balance for selection ---
  const mintOptions = useMemo(() => {
    if (!serverDefaults) return []
    const fee = serverDefaults.addressFee
    return Object.entries(balanceByMint)
      .filter(([, balance]) => balance >= fee)
      .map(([url, balance]) => {
        const isAccepted = serverDefaults.acceptedMints.some(
          (am) => normalizeMintUrl(am) === normalizeMintUrl(url)
        )
        return { url, balance, isAccepted }
      })
      .sort((a, b) => {
        // Accepted first, then by balance descending
        if (a.isAccepted !== b.isAccepted) return a.isAccepted ? -1 : 1
        return b.balance - a.balance
      })
  }, [balanceByMint, serverDefaults])

  // --- MintCard-compatible infos ---
  const mintInfos: MintInfo[] = useMemo(() => {
    return mintOptions.map(({ url, balance }) => {
      const cachedStatus = getCachedStatus(url)
      return {
        url,
        name: getDisplayName(url),
        iconUrl: getIconUrl(url),
        balance,
        isOnline: cachedStatus?.isOnline ?? true,
        lastChecked: cachedStatus?.lastChecked,
      }
    })
  }, [mintOptions, getCachedStatus, getDisplayName, getIconUrl])

  // --- Payment execution ---
  const handleConfirm = useCallback(async () => {
    if (!usernameAvailable || isChanging || !serverDefaults || !selectedMintUrl || !nostrPrivkey) return
    setIsChanging(true)
    try {
      const { addressFee: fee, acceptedMints } = serverDefaults
      const isAccepted = acceptedMints.some(
        (am) => normalizeMintUrl(am) === normalizeMintUrl(selectedMintUrl)
      )

      let paymentMintUrl = selectedMintUrl
      let swapFee = 0

      if (!isAccepted && fee > 0) {
        // Swap to an accepted mint first
        const targetMint = acceptedMints[0]
        if (!targetMint) {
          addToast({ type: 'error', message: t('settings.paymentFailed') })
          return
        }
        const swapResult = await services.payment.mintSwap(
          selectedMintUrl,
          normalizeMintUrl(targetMint),
          fee
        )
        if (swapResult.isErr()) {
          addToast({ type: 'error', message: translateError(swapResult.error) })
          return
        }
        paymentMintUrl = normalizeMintUrl(targetMint)
        swapFee = swapResult.value.fee

        // Update swap transaction memo + total cost (including swap fee)
        const transactionRepo = new TransactionRepository()
        await transactionRepo.update(swapResult.value.transactionId, {
          memo: t('settings.addressChangeFee', { username: newUsername }),
          amount: fee + swapFee,
        })
      }

      // Create fee payment token
      let cashuToken = ''
      if (fee > 0) {
        try {
          cashuToken = await sendToken(paymentMintUrl, fee)
        } catch (sendError) {
          const message = sendError instanceof BaseError
            ? translateError(sendError)
            : t('settings.paymentFailed')
          addToast({ type: 'error', message })
          return
        }
      }

      // Submit username change
      const result = await zappiLinkService.changeUsername(nostrPrivkey, newUsername, cashuToken)
      if (result.isErr()) {
        addToast({ type: 'error', message: translateError(result.error) })
        return
      }

      // Record fee transaction (only for direct payment; swap already recorded)
      if (fee > 0 && isAccepted) {
        const transactionRepo = new TransactionRepository()
        await transactionRepo.create({
          id: `tx-fee-${crypto.randomUUID()}`,
          direction: 'send',
          type: 'ecash',
          amount: fee,
          mintUrl: paymentMintUrl,
          status: 'completed',
          createdAt: Date.now(),
          completedAt: Date.now(),
          memo: t('settings.addressChangeFee', { username: newUsername }),
        })
      }

      // Persist settings + dismiss screen immediately
      updateSettings({ lightningAddress: result.value.address })
      await onSaveSettings({ ...settings, lightningAddress: result.value.address })
      triggerTxRefresh()

      addToast({
        type: 'success',
        message: swapFee > 0
          ? `${t('settings.usernameChanged')} (₿ ${fee.toLocaleString()} + ${t('settings.swapFee')} ₿ ${swapFee.toLocaleString()})`
          : fee > 0
            ? `${t('settings.usernameChanged')} (₿ ${fee.toLocaleString()})`
            : t('settings.usernameChanged'),
      })
      onBack()
    } catch (error) {
      console.error('[UsernameChange] Error:', error)
      const message = error instanceof BaseError
        ? translateError(error)
        : t('settings.usernameChangeFailed')
      addToast({ type: 'error', message })
    } finally {
      setIsChanging(false)
    }
  }, [
    usernameAvailable,
    isChanging,
    serverDefaults,
    selectedMintUrl,
    nostrPrivkey,
    newUsername,
    services.payment,
    zappiLinkService,
    addToast,
    updateSettings,
    onSaveSettings,
    settings,
    triggerTxRefresh,
    onBack,
    t,
  ])

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden z-[60]">
      {/* Header */}
      <header className="flex items-center px-3 pt-4 relative z-50">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 rounded-lg bg-white/60 shadow-sm hover:shadow-md transition-all hover:bg-background-card backdrop-blur-md"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <h2 className="text-base font-bold tracking-tight ml-3">
          {t('settings.changeUsername')}
        </h2>
      </header>

      {isChanging ? (
        /* Processing screen */
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <Loader2 className="w-12 h-12 text-accent-primary animate-spin" />
          <div className="flex flex-col items-center gap-2">
            <p className="text-base font-bold text-foreground">
              {t('settings.changingUsername')}
            </p>
            <div className="flex flex-col items-center gap-1 text-sm text-foreground-muted">
              <span>{prevAddressRef.current}</span>
              <span>↓</span>
              <span className="font-bold text-foreground">{newUsername}@{ZAPPI_LINK_DOMAIN}</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-32">
            {/* Current address */}
            <section>
              <label className="text-[10px] font-bold text-foreground-muted mb-1 block px-2">
                {t('settings.currentAddress')}
              </label>
              <div className="bg-white/60 rounded-lg p-3 shadow-sm border border-white/50">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-accent-primary shrink-0" />
                  <span className="text-xs font-bold text-foreground truncate">
                    {settings.lightningAddress || '-'}
                  </span>
                </div>
              </div>
            </section>

            {/* New username input */}
            <section>
              <label className="text-[10px] font-bold text-foreground-muted mb-1 block px-2">
                {t('settings.newUsername')}
              </label>
              <div className="bg-white/60 rounded-lg p-3 shadow-sm border border-white/50">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
                    placeholder="username"
                    className="flex-1 p-2.5 rounded-md border border-primary/10 bg-white/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    maxLength={20}
                    autoFocus
                  />
                  <span className="text-xs text-foreground-muted shrink-0">
                    @{ZAPPI_LINK_DOMAIN}
                  </span>
                </div>

                {/* Validation status */}
                {newUsername && (
                  <div className="mt-1.5 ml-1 flex items-center gap-1.5">
                    {isCheckingUsername ? (
                      <Loader2 className="w-3 h-3 text-foreground-muted animate-spin" />
                    ) : usernameAvailable ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-accent-success" />
                        <span className="text-[10px] text-accent-success font-bold">
                          {t('settings.usernameAvailable')}
                        </span>
                      </>
                    ) : usernameError ? (
                      <>
                        <XCircle className="w-3 h-3 text-accent-danger" />
                        <span className="text-[10px] text-accent-danger font-bold">
                          {usernameError}
                        </span>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </section>

            {/* Fee info */}
            {serverDefaults && addressFee > 0 && (
              <section>
                <label className="text-[10px] font-bold text-foreground-muted mb-1 block px-2">
                  {t('settings.changeFee')}
                </label>
                <div className="bg-white/60 rounded-lg p-3 shadow-sm border border-white/50 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-foreground-muted">
                      {t('settings.changeFee')}
                    </span>
                    <span className="text-xs font-bold">
                      ₿ {addressFee.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-foreground-muted">
                      {t('common.balance')}
                    </span>
                    <span
                      className={cn(
                        'text-xs font-bold',
                        canAfford ? 'text-foreground' : 'text-accent-danger'
                      )}
                    >
                      ₿ {selectedBalance.toLocaleString()}
                    </span>
                  </div>
                  {!canAfford && selectedMintUrl && (
                    <p className="text-[10px] text-accent-danger font-bold mt-1">
                      {t('settings.insufficientBalance')}
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* Mint selection (only when fee > 0) */}
            {serverDefaults && addressFee > 0 && (
              <section>
                <label className="text-[10px] font-bold text-foreground-muted mb-1 block px-2">
                  {t('settings.paymentMint')}
                </label>
                {mintInfos.length === 0 ? (
                  <div className="bg-white/60 rounded-lg p-3 shadow-sm border border-white/50">
                    <p className="text-[10px] text-accent-danger font-bold text-center">
                      {t('settings.noPayableMint')}
                    </p>
                  </div>
                ) : (
                  <div className="w-full overflow-x-auto pb-3 pt-1 scrollbar-hide snap-x snap-mandatory">
                    <div className="flex gap-3 px-[calc(50%-var(--card-w)/2)]">
                      {mintInfos.map((mint, idx) => (
                        <div key={mint.url} className="snap-center shrink-0">
                          <MintCard
                            mint={mint}
                            variant={getVariantByIndex(idx)}
                            isSelected={selectedMintUrl === mint.url}
                            onClick={() => setSelectedMintUrl(mint.url)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Swap warning for non-accepted mints */}
                {selectedMintUrl && !isAcceptedMint && (
                  <div className="mt-2 p-3 bg-accent-warning/5 rounded-lg border border-accent-warning/10">
                    <p className="text-[10px] text-accent-warning font-bold">
                      {t('settings.additionalFeeWarning')}
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Bottom action bar */}
          <div className="absolute bottom-0 left-0 right-0 p-4 pb-safe bg-gradient-to-t from-background via-background to-transparent">
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="lg"
                onClick={onBack}
                className="flex-1"
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                size="lg"
                onClick={handleConfirm}
                disabled={
                  !usernameAvailable ||
                  (addressFee > 0 && !canAfford) ||
                  isCheckingUsername
                }
                className="flex-1"
              >
                {addressFee > 0
                  ? `${t('settings.changeUsername')} (₿ ${addressFee.toLocaleString()})`
                  : t('settings.changeUsername')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default UsernameChangeScreen
