import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { ArrowLeft, Zap, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFormatSats } from '@/utils/format'
import { Button } from '../../components/common'
import { MintCard, resolveMintColor } from '../../components/wallet/MintCard'
import { cn } from '@/ui/primitives/utils'
import { useAppStore } from '@/store'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useMintHealth } from '@/ui/hooks/use-mint-health'
import type { MintInfo } from '@/core/types'
import { normalizeMintUrl, isSameMintUrl, getMintBalance } from '@/utils/url'
import type { ProviderDefaults } from '@/core/ports/driving/username.usecase'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import type { Amount } from '@/core/domain/amount'
import { ZAPPI_LINK_DOMAIN } from '@/core/constants'

const USERNAME_REGEX = /^[a-z0-9]{3,20}$/

export interface UsernameChangeScreenProps {
  onBack: () => void
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
}

export function UsernameChangeScreen({ onBack, onSaveSettings }: UsernameChangeScreenProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()

  const settings = useAppStore((state) => state.settings)
  const nostrPrivkey = useAppStore((state) => state.nostrPrivkey)
  const balanceByMint = useAppStore((state) => state.balance.byMint)
  const addToast = useAppStore((state) => state.addToast)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const triggerTxRefresh = useAppStore((state) => state.triggerTxRefresh)

  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)
  const { getCachedStatus } = useMintHealth()
  const registry = useServiceRegistry()

  // Username validation
  const [newUsername, setNewUsername] = useState('')
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [usernameError, setUsernameError] = useState('')
  const [isCheckingUsername, setIsCheckingUsername] = useState(false)
  const [serverDefaults, setProviderDefaults] = useState<ProviderDefaults | null>(null)
  const serverDefaultsRef = useRef<ProviderDefaults | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Mint selection
  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(null)

  // Payment
  const [isChanging, setIsChanging] = useState(false)
  const prevAddressRef = useRef(settings.lightningAddress || '-')

  // --- Auto-select best mint ---
  const autoSelectMint = useCallback((defaults: ProviderDefaults) => {
    const fee = defaults.addressFee
    const mintEntries = Object.entries(balanceByMint)
      .map(([url, balance]) => ({ url, balance }))
      .filter(({ balance }) => balance > 0)

    const accepted: typeof mintEntries = []
    const nonAccepted: typeof mintEntries = []

    for (const entry of mintEntries) {
      const isAccepted = defaults.acceptedMints.some(
        (am) => isSameMintUrl(am, entry.url)
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
        const result = await registry.username.checkUsername(newUsername)
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
          const defaultsResult = await registry.username.getDefaults()
          if (defaultsResult.isOk()) {
            serverDefaultsRef.current = defaultsResult.value
            setProviderDefaults(defaultsResult.value)
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
  }, [newUsername, registry, t, autoSelectMint])

  // --- Derived: affordability ---
  const addressFee = serverDefaults?.addressFee ?? 0
  const isAcceptedMint =
    selectedMintUrl && serverDefaults
      ? serverDefaults.acceptedMints.some(
          (am) => isSameMintUrl(am, selectedMintUrl)
        )
      : false
  const selectedBalance = selectedMintUrl ? getMintBalance(selectedMintUrl, balanceByMint) : 0
  const canAfford = selectedMintUrl ? selectedBalance >= addressFee : false

  // --- All mints with sufficient balance for selection ---
  const mintOptions = useMemo(() => {
    if (!serverDefaults) return []
    const fee = serverDefaults.addressFee
    return Object.entries(balanceByMint)
      .filter(([, balance]) => balance >= fee)
      .map(([url, balance]) => {
        const isAccepted = serverDefaults.acceptedMints.some(
          (am) => isSameMintUrl(am, url)
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
        (am) => isSameMintUrl(am, selectedMintUrl)
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
        const swapResult = await registry.swap.executeSwap({
          sourceAccountId: selectedMintUrl,
          targetAccountId: normalizeMintUrl(targetMint),
          amount: { value: BigInt(fee), unit: 'sat' } as Amount,
        })
        if (!swapResult.ok) {
          addToast({ type: 'error', message: String((swapResult.error as { message?: string }).message ?? t('settings.paymentFailed')) })
          return
        }
        paymentMintUrl = normalizeMintUrl(targetMint)
        swapFee = Number(swapResult.value.fee.value)
      }

      // Create fee payment token
      let cashuToken = ''
      if (fee > 0) {
        try {
          const sendResult = await registry.payment.send({
            accountId: paymentMintUrl,
            amount: { value: BigInt(fee), unit: 'sat' } as Amount,
            options: { createToken: true },
          })
          if (!sendResult.ok) throw sendResult.error
          cashuToken = (sendResult.value as { token?: string }).token ?? ''
        } catch (sendError) {
          const message = sendError instanceof Error
            ? sendError.message
            : t('settings.paymentFailed')
          addToast({ type: 'error', message })
          return
        }
      }

      // Submit username change
      const result = await registry.username.changeUsername(nostrPrivkey, newUsername, cashuToken)
      if (result.isErr()) {
        addToast({ type: 'error', message: String((result.error as { message?: string }).message ?? t('settings.paymentFailed')) })
        return
      }

      // Fee transaction is automatically recorded by PaymentService.send()

      // Persist settings + dismiss screen immediately
      updateSettings({ lightningAddress: result.value.address })
      await onSaveSettings({ ...settings, lightningAddress: result.value.address })
      triggerTxRefresh()

      addToast({
        type: 'success',
        message: swapFee > 0
          ? `${t('settings.usernameChanged')} (${formatSats(fee)} + ${t('settings.swapFee')} ${formatSats(swapFee)})`
          : fee > 0
            ? `${t('settings.usernameChanged')} (${formatSats(fee)})`
            : t('settings.usernameChanged'),
      })
      onBack()
    } catch (error) {
      console.error('[UsernameChange] Error:', error)
      const message = error instanceof Error
        ? error.message
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
    registry,
    addToast,
    updateSettings,
    onSaveSettings,
    settings,
    triggerTxRefresh,
    onBack,
    t,
    formatSats,
  ])

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden z-[60]">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0 z-50">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h2 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">
          {t('settings.changeUsername')}
        </h2>
        <div className="w-10" />
      </header>

      {isChanging ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <Loader2 className="w-12 h-12 text-brand animate-spin" />
          <div className="flex flex-col items-center gap-2">
            <p className="text-body font-bold text-foreground">
              {t('settings.changingUsername')}
            </p>
            <div className="flex flex-col items-center gap-1 text-caption text-foreground-muted">
              <span>{prevAddressRef.current}</span>
              <span>↓</span>
              <span className="font-bold text-foreground">{newUsername}@{ZAPPI_LINK_DOMAIN}</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-6 pt-6 pb-app-action">
            {/* Current address */}
            <p className="text-body font-medium text-foreground-muted">{t('settings.currentAddress')}</p>
            <div className="flex items-center gap-2 mt-1.5 mb-8">
              <Zap className="w-5 h-5 text-brand shrink-0" />
              <span className="text-subtitle font-medium text-foreground truncate">
                {settings.lightningAddress || '-'}
              </span>
            </div>

            {/* New username input */}
            <p className="text-body font-medium text-foreground-muted mb-1.5">{t('settings.newUsername')}</p>
            <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
                placeholder="username"
                className="flex-1 min-w-0 bg-transparent py-2.5 text-subtitle font-medium text-foreground placeholder:text-foreground-muted focus:outline-none"
                maxLength={20}
                autoFocus
              />
              <span className="text-body text-foreground-muted shrink-0">@{ZAPPI_LINK_DOMAIN}</span>
            </div>

            {/* Validation status */}
            <div className="h-7 flex items-center mt-1.5">
              {newUsername && (
                isCheckingUsername ? (
                  <Loader2 className="w-4 h-4 text-foreground-muted animate-spin" />
                ) : usernameAvailable ? (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-accent-success" />
                    <span className="text-body text-accent-success font-medium">{t('settings.usernameAvailable')}</span>
                  </div>
                ) : usernameError ? (
                  <div className="flex items-center gap-1.5">
                    <XCircle className="w-4 h-4 text-accent-danger" />
                    <span className="text-body text-accent-danger font-medium">{usernameError}</span>
                  </div>
                ) : null
              )}
            </div>

            {/* Fee info */}
            {serverDefaults && addressFee > 0 && (
              <div className="mt-6 space-y-2">
                <div className="flex items-center justify-between py-2.5 border-b border-border/50">
                  <span className="text-body text-foreground-muted">{t('settings.changeFee')}</span>
                  <span className="text-body font-semibold font-display">{formatSats(addressFee)}</span>
                </div>
                <div className="flex items-center justify-between py-2.5">
                  <span className="text-body text-foreground-muted">{t('common.balance')}</span>
                  <span className={cn('text-body font-semibold font-display', canAfford ? 'text-foreground' : 'text-accent-danger')}>
                    {formatSats(selectedBalance)}
                  </span>
                </div>
                {!canAfford && selectedMintUrl && (
                  <p className="text-body text-accent-danger">{t('settings.insufficientBalance')}</p>
                )}
              </div>
            )}

            {/* Mint selection */}
            {serverDefaults && addressFee > 0 && (
              <div className="mt-6">
                <p className="text-body font-medium text-foreground-muted mb-2">{t('settings.paymentMint')}</p>
                {mintInfos.length === 0 ? (
                  <p className="text-body text-accent-danger text-center py-4">{t('settings.noPayableMint')}</p>
                ) : (
                  <div className="w-[calc(100%+3rem)] -mx-6 overflow-x-auto pb-3 pt-1 scrollbar-hide snap-x snap-mandatory">
                    <div className="flex gap-2 px-[calc(50%-var(--card-w)/2)]">
                      {mintInfos.map((mint) => (
                        <div key={mint.url} className="snap-center snap-always shrink-0">
                          <MintCard
                            mint={mint}
                            {...resolveMintColor(mint.url, settings.mints.indexOf(mint.url), settings.mintColors)}
                            isSelected={selectedMintUrl === mint.url}
                            onClick={() => setSelectedMintUrl(mint.url)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedMintUrl && !isAcceptedMint && (
                  <p className="text-body text-accent-warning mt-2">{t('settings.additionalFeeWarning')}</p>
                )}
              </div>
            )}
          </div>

          {/* Bottom action */}
          <div className="absolute bottom-0 left-0 right-0 px-6 pb-app bg-gradient-to-t from-background via-background to-transparent pt-4">
            <Button
              variant="brand"
              size="xl"
              onClick={handleConfirm}
              disabled={!usernameAvailable || (addressFee > 0 && !canAfford) || isCheckingUsername}
              className="w-full"
            >
              {addressFee > 0
                ? `${t('common.change')} (${formatSats(addressFee)})`
                : t('common.change')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

export default UsernameChangeScreen
