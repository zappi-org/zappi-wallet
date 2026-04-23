import { useState, useCallback, useRef, useEffect, useMemo } from 'react'

import { ArrowLeft, Plus, AlertCircle, TrendingUp, Loader2, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/ui/lib/utils'
import { Button } from '@/ui/components/common/Button'
import { ProgressStepper } from '@/ui/components/common/ProgressStepper'
import { ConfirmDialog } from '@/ui/components/common/ConfirmDialog'
import { useAppStore } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { generateMintAliases } from '@/utils/mint-name'
import { normalizeMintUrl, formatMintHost } from '@/utils/url'
import { LIMITS } from '@/core/constants'
import { formatSats } from '@/utils/format'
import { MintCard, getVariantByIndex } from '@/ui/components/wallet/MintCard'
import type { MintInfo } from '@/core/types'

export interface AddMintScreenProps {
  onBack: () => void
  onSuccess?: () => void
  onSaveSettings?: (settings: Record<string, unknown>) => Promise<void>
}

// 8333.space API response type
interface DiscoveredMint {
  url: string
  name: string | null
  state: 'OK' | 'ERROR' | string
  n_mints: number
  n_melts: number
}

async function fetchDiscoveredMints(): Promise<DiscoveredMint[]> {
  const response = await fetch('https://api.audit.8333.space/mints')
  if (!response.ok) throw new Error('Failed to fetch mints')
  const data = await response.json()
  return data
    .filter((m: DiscoveredMint) => m.state === 'OK')
    .sort((a: DiscoveredMint, b: DiscoveredMint) =>
      (b.n_mints + b.n_melts) - (a.n_mints + a.n_melts)
    )
}

type ProgressStep = 'validating' | 'adding' | 'restoring' | null

const PROGRESS_ORDER: Exclude<ProgressStep, null>[] = ['validating', 'adding', 'restoring']

export function AddMintScreen({ onBack, onSuccess, onSaveSettings }: AddMintScreenProps) {
  const { t } = useTranslation()
  const registry = useServiceRegistry()
  const [url, setUrl] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [progressStep, setProgressStep] = useState<ProgressStep>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [recoveredAmount, setRecoveredAmount] = useState<number | null>(null)

  // Global mint discovery state (auto-loaded)
  const [discoveredMints, setDiscoveredMints] = useState<DiscoveredMint[]>([])
  const [isLoadingDiscovery, setIsLoadingDiscovery] = useState(true)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)

  const [addingMintName, setAddingMintName] = useState<string | null>(null)
  const [addingMintUrl, setAddingMintUrl] = useState<string | null>(null)
  const [addingMintIconUrl, setAddingMintIconUrl] = useState<string | undefined>(undefined)
  const [addingMintAlias, setAddingMintAlias] = useState<string | null>(null)

  // Confirm dialog state
  const [confirmMint, setConfirmMint] = useState<{ url: string; name: string } | null>(null)

  const settings = useAppStore((s) => s.settings)
  const mints = settings.mints
  const setBalance = useAppStore((s) => s.setBalance)

  const mintCountBeforeAdd = useRef(mints.length)
  const displayMintCount = isAdding ? mintCountBeforeAdd.current : mints.length
  const isAtLimit = displayMintCount >= LIMITS.MAX_MINTS

  const progressMessages = useMemo<Record<Exclude<ProgressStep, null>, string>>(() => ({
    validating: t('addMint.validating'),
    adding: t('addMint.adding'),
    restoring: t('addMint.restoring'),
  }), [t])

  // Auto-load global mint list on mount
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setIsLoadingDiscovery(true)
      setDiscoveryError(null)
      try {
        const result = await fetchDiscoveredMints()
        if (!cancelled) setDiscoveredMints(result)
      } catch {
        if (!cancelled) setDiscoveryError(t('addMint.loadError'))
      } finally {
        if (!cancelled) setIsLoadingDiscovery(false)
      }
    }
    load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t causes re-fetch on language change; error message is non-critical
  }, [])

  const handleRetryDiscovery = useCallback(async () => {
    setIsLoadingDiscovery(true)
    setDiscoveryError(null)
    try {
      const result = await fetchDiscoveredMints()
      setDiscoveredMints(result)
    } catch {
      setDiscoveryError(t('addMint.loadError'))
    } finally {
      setIsLoadingDiscovery(false)
    }
  }, [t])

  const handleAdd = useCallback(async (mintUrl?: string, mintName?: string) => {
    const targetUrl = mintUrl || url
    if (!targetUrl) return

    if (isAtLimit) {
      setError(t('addMint.maxMintsReached', { max: LIMITS.MAX_MINTS }))
      return
    }

    const normalizedUrl = normalizeMintUrl(targetUrl)

    if (mints.some((m) => m === normalizedUrl)) {
      setError(t('addMint.alreadyAdded'))
      return
    }

    mintCountBeforeAdd.current = mints.length
    const displayName = mintName || formatMintHost(targetUrl)
    setAddingMintName(displayName)
    setAddingMintUrl(normalizedUrl)
    setIsAdding(true)
    setError(null)
    setProgressStep('validating')

    try {
      const metadata = await registry.mintMetadata.fetchAndCache(normalizedUrl)
      if (!metadata) {
        throw new Error(t('addMint.addFailed'))
      }
      setAddingMintIconUrl(metadata.iconUrl)

      setProgressStep('adding')

      const newMints = [...mints, normalizedUrl]
      const newAliases = generateMintAliases(
        newMints,
        settings.mintAliases,
        (number) => t('mintDetail.defaultName', { number }),
      )
      const alias = newAliases[normalizedUrl]
      setAddingMintAlias(alias)
      if (onSaveSettings) {
        await onSaveSettings({ mints: newMints, mintAliases: newAliases })
      }

      setProgressStep('restoring')

      try {
        const beforeModules = await registry.balance.getByModule()
        const beforeTotal = beforeModules.reduce((sum, m) => sum + m.accounts.reduce((s, a) => s + Number(a.amount.value), 0), 0)

        // Recover tokens for the newly added mint via recoverAll
        await registry.payment.recoverAll()

        const afterModules = await registry.balance.getByModule()
        const afterTotal = afterModules.reduce((sum, m) => sum + m.accounts.reduce((s, a) => s + Number(a.amount.value), 0), 0)
        const byMint: Record<string, number> = {}
        for (const m of afterModules) {
          for (const a of m.accounts) {
            byMint[a.id] = Number(a.amount.value)
          }
        }
        setBalance({ total: afterTotal, byMint })

        const recovered = afterTotal - beforeTotal
        if (recovered > 0) {
          setRecoveredAmount(recovered)
        }
      } catch (restoreErr) {
        console.warn('[AddMint] Failed to restore tokens from new mint:', restoreErr)
      }

      setProgressStep(null)
      setSuccess(true)
      setTimeout(() => {
        onSuccess?.()
        onBack()
      }, 3000)
    } catch (err) {
      if (err instanceof TypeError) {
        setError(t('addMint.addFailed'))
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError(t('addMint.addFailed'))
      }
    } finally {
      setIsAdding(false)
      setProgressStep(null)
    }
  }, [url, mints, isAtLimit, onSaveSettings, onBack, onSuccess, setBalance, t, settings.mintAliases, registry])

  // Request confirmation before adding
  const requestAdd = useCallback((mintUrl: string, mintName: string) => {
    const normalizedUrl = normalizeMintUrl(mintUrl)
    if (mints.some((m) => m === normalizedUrl)) {
      setError(t('addMint.alreadyAdded'))
      return
    }
    if (isAtLimit) {
      setError(t('addMint.maxMintsReached', { max: LIMITS.MAX_MINTS }))
      return
    }
    setConfirmMint({ url: mintUrl, name: mintName })
  }, [mints, isAtLimit, t])

  // Full-screen progress view (adding or success)
  if (isAdding || success) {
    return (
      <div className="h-dvh bg-background text-foreground flex flex-col pt-safe pb-safe z-[60]">
        {/* Header */}
        <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
          <div className="w-10" />
          <h2 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">{t('addMint.title')}</h2>
          <div className="w-10" />
        </header>

        <div className="flex-1 flex flex-col items-center justify-center px-6">
          {success ? (() => {
            const cardMintInfo: MintInfo = {
              url: addingMintUrl || '',
              name: addingMintAlias || addingMintName || undefined,
              alias: addingMintAlias || undefined,
              mintName: addingMintName || undefined,
              iconUrl: addingMintIconUrl,
              balance: recoveredAmount || 0,
              isOnline: true,
            }
            const variantIndex = mintCountBeforeAdd.current
            return (
              <div className="animate-fadeIn flex flex-col items-center">
                <div className="animate-cardFlipIn mb-6 text-left" style={{ perspective: '800px' }}>
                  <MintCard
                    mint={cardMintInfo}
                    variant={getVariantByIndex(variantIndex)}
                    hideBalance={false}
                  />
                </div>
                <h3 className="text-subtitle font-bold text-foreground mb-1 text-center">
                  <span className="text-brand">{addingMintAlias || addingMintName}</span>
                  {t('addMint.hasBeenAdded')}
                </h3>
                {recoveredAmount && recoveredAmount > 0 && (
                  <p className="text-caption text-foreground-muted text-center">
                    {t('addMint.recoveredTokens', { amount: formatSats(recoveredAmount) })}
                  </p>
                )}
              </div>
            )
          })() : (
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 border-3 border-brand/20 border-t-brand rounded-full animate-spin mb-6" />
              <p className="text-subtitle font-bold text-brand mb-1">{addingMintName}</p>
              <p className="text-caption text-foreground-muted mb-6">
                {formatMintHost(addingMintUrl || '')}
              </p>
              <ProgressStepper steps={PROGRESS_ORDER} currentStep={progressStep} labels={progressMessages} />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="animate-slideInUp h-dvh bg-background text-foreground flex flex-col font-primary relative overflow-hidden z-[60] pt-safe">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h2 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">{t('addMint.title')}</h2>
        <span className={cn(
          "text-overline font-medium z-10",
          isAtLimit ? "text-accent-danger" : "text-foreground-muted"
        )}>
          {displayMintCount}/{LIMITS.MAX_MINTS}
        </span>
      </header>

      {/* URL Input */}
      <div className="px-4 pt-4 pb-2 space-y-2">
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null) }}
            placeholder={t('addMint.urlPlaceholder')}
            className="flex-1 px-3 py-2.5 rounded-xl bg-background border border-border text-caption focus:outline-none focus:ring-1 focus:ring-foreground/20 placeholder:text-foreground-muted/50"
          />
          <button
            onClick={() => {
              if (!url) return
              const name = formatMintHost(url)
              requestAdd(url, name)
            }}
            disabled={!url || isAtLimit}
            className={cn(
              'px-4 py-2.5 rounded-xl font-semibold text-caption shrink-0 transition-colors',
              url && !isAtLimit
                ? 'bg-brand text-white active:opacity-80'
                : 'bg-foreground/10 text-foreground-muted cursor-not-allowed'
            )}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-1.5 text-accent-danger ml-1">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <p className="text-overline font-medium">{error}</p>
          </div>
        )}
        {isAtLimit && (
          <p className="text-overline font-medium text-accent-danger ml-1">
            {t('settings.mintDeleteMaxReached')}
          </p>
        )}
      </div>

      {/* Global Mint List */}
      <div className="flex-1 overflow-y-auto">
        <p className="text-caption font-medium uppercase tracking-wide text-foreground-muted px-4 pt-3 pb-2">
          {t('addMint.worldwide')}
        </p>

        {isLoadingDiscovery ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-foreground-muted animate-spin mb-2" />
            <p className="text-caption text-foreground-muted">{t('addMint.loading')}</p>
          </div>
        ) : discoveryError ? (
          <div className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="w-6 h-6 text-accent-danger mb-2" />
            <p className="text-caption text-accent-danger mb-3">{discoveryError}</p>
            <Button variant="brand" size="sm" onClick={handleRetryDiscovery}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <div className="bg-background-card divide-y divide-border pb-safe">
            {discoveredMints.map((mint, i) => {
              const normalizedMintUrl = normalizeMintUrl(mint.url)
              const isAlreadyAdded = mints.some(
                (m) => m === mint.url || m === normalizedMintUrl
              )
              const totalTx = mint.n_mints + mint.n_melts
              const displayName = mint.name || formatMintHost(mint.url)

              return (
                <button
                  key={i}
                  onClick={() => {
                    if (!isAlreadyAdded && !isAtLimit) {
                      requestAdd(mint.url, displayName)
                    }
                  }}
                  disabled={isAlreadyAdded || isAtLimit}
                  className={cn(
                    'w-full px-4 py-3 flex items-center gap-3 text-left transition-colors',
                    isAlreadyAdded || isAtLimit
                      ? 'opacity-50'
                      : 'active:bg-foreground/[0.03]'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-caption font-medium text-foreground truncate">
                        {displayName}
                      </span>
                      {isAlreadyAdded && (
                        <Check className="w-3.5 h-3.5 text-accent-primary shrink-0" />
                      )}
                    </div>
                    <span className="text-overline font-medium text-foreground-muted truncate block">
                      {mint.url.replace('https://', '')}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <TrendingUp className="w-3 h-3 text-foreground-muted" />
                      <span className="text-overline font-medium text-foreground-muted">
                        {t('addMint.transactions', { count: totalTx })}
                      </span>
                    </div>
                  </div>
                  {!isAlreadyAdded && !isAtLimit && (
                    <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-foreground/[0.06] shrink-0">
                      <Plus className="w-4 h-4 text-foreground-muted" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={!!confirmMint}
        onClose={() => setConfirmMint(null)}
        onConfirm={() => {
          if (confirmMint) {
            handleAdd(confirmMint.url, confirmMint.name)
            setConfirmMint(null)
          }
        }}
        title={confirmMint?.name || ''}
        description={t('addMint.confirmTitle')}
        confirmLabel={t('addMint.confirmAdd')}
        cancelLabel={t('common.cancel')}
        confirmVariant="primary"
      />
    </div>
  )
}

export default AddMintScreen
