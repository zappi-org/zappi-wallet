import { useState, useCallback, useRef } from 'react'

import { ArrowLeft, Plus, Search, Check, AlertCircle, Globe, TrendingUp, X, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { mintMetadataService } from '@/services/mint-metadata'
import { restoreWallet, getBalances } from '@/coco'
import { normalizeMintUrl } from '@/utils/url'
import { LIMITS } from '@/core/constants'

export interface AddMintScreenProps {
  onBack: () => void
  onSuccess?: () => void
  onSaveSettings?: (settings: Record<string, unknown>) => Promise<void>
}

const RECOMMENDED_MINTS = [
  {
    url: 'https://mint.minibits.cash/Bitcoin',
    name: 'Minibits',
    descriptionKey: 'addMint.mintDescMinibits',
  },
  {
    url: 'https://mint.coinos.io',
    name: 'Coinos',
    descriptionKey: 'addMint.mintDescCoinos',
  },
  {
    url: 'https://mint.lnbits.com/cashu/api/v1/AptDNABNBXv8gpuywhx6NV',
    name: 'LNbits',
    descriptionKey: 'addMint.mintDescLnbits',
  },
]

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
  // Filter only OK mints and sort by activity
  return data
    .filter((m: DiscoveredMint) => m.state === 'OK')
    .sort((a: DiscoveredMint, b: DiscoveredMint) =>
      (b.n_mints + b.n_melts) - (a.n_mints + a.n_melts)
    )
}

type ProgressStep = 'validating' | 'adding' | 'restoring' | null

export function AddMintScreen({ onBack, onSuccess, onSaveSettings }: AddMintScreenProps) {
  const { t } = useTranslation()
  const [url, setUrl] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [progressStep, setProgressStep] = useState<ProgressStep>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [recoveredAmount, setRecoveredAmount] = useState<number | null>(null)

  // Mint discovery state
  const [isDiscoveryOpen, setIsDiscoveryOpen] = useState(false)
  const [discoveredMints, setDiscoveredMints] = useState<DiscoveredMint[]>([])
  const [isLoadingDiscovery, setIsLoadingDiscovery] = useState(false)
  const [discoveryError, setDiscoveryError] = useState<string | null>(null)

  const settings = useAppStore((s) => s.settings)
  const mints = settings.mints
  const setBalance = useAppStore((s) => s.setBalance)

  // Freeze the displayed count during add process to prevent premature badge/limit update
  const mintCountBeforeAdd = useRef(mints.length)
  const displayMintCount = isAdding ? mintCountBeforeAdd.current : mints.length
  const isAtLimit = displayMintCount >= LIMITS.MAX_MINTS

  const progressMessages: Record<Exclude<ProgressStep, null>, string> = {
    validating: t('addMint.validating'),
    adding: t('addMint.adding'),
    restoring: t('addMint.restoring'),
  }

  const handleAdd = useCallback(async () => {
    if (!url) return

    // Check limit
    if (isAtLimit) {
      setError(t('addMint.maxMintsReached', { max: LIMITS.MAX_MINTS }))
      return
    }

    // Normalize URL (auto-add https:// if missing, remove trailing slash)
    const normalizedUrl = normalizeMintUrl(url)

    // Check if already added
    if (mints.some((m) => m === normalizedUrl)) {
      setError(t('addMint.alreadyAdded'))
      return
    }

    mintCountBeforeAdd.current = mints.length
    setIsAdding(true)
    setError(null)
    setProgressStep('validating')

    try {
      // Fetch and cache mint metadata (validates mint and stores for offline use)
      const metadata = await mintMetadataService.fetchAndCache(normalizedUrl)
      if (!metadata) {
        throw new Error(t('addMint.addFailed'))
      }

      setProgressStep('adding')

      // Add mint to settings and persist to IndexedDB
      const newMints = [...mints, normalizedUrl]
      if (onSaveSettings) {
        await onSaveSettings({ mints: newMints })
      }

      setProgressStep('restoring')

      // Restore tokens from the new mint (check for unused proofs)
      try {
        const beforeBalances = await getBalances()
        const beforeTotal = Object.values(beforeBalances).reduce((sum, b) => sum + b, 0)

        await restoreWallet(normalizedUrl)

        const afterBalances = await getBalances()
        const afterTotal = Object.values(afterBalances).reduce((sum, b) => sum + b, 0)
        setBalance({ total: afterTotal, byMint: afterBalances })

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
      }, 1500)
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
  }, [url, mints, isAtLimit, onSaveSettings, onBack, onSuccess, setBalance, t])

  const handleSelectRecommended = (mintUrl: string) => {
    setUrl(mintUrl)
    setError(null)
  }

  const handleOpenDiscovery = useCallback(async () => {
    setIsDiscoveryOpen(true)
    setIsLoadingDiscovery(true)
    setDiscoveryError(null)

    try {
      const mints = await fetchDiscoveredMints()
      setDiscoveredMints(mints)
    } catch {
      setDiscoveryError(t('addMint.loadError'))
    } finally {
      setIsLoadingDiscovery(false)
    }
  }, [t])

  const handleSelectDiscovered = (mintUrl: string) => {
    setUrl(mintUrl)
    setError(null)
    setIsDiscoveryOpen(false)
  }

  if (success) {
    return (
      <div className="animate-fadeIn h-dvh bg-background flex flex-col items-center justify-center p-4 text-center pt-safe pb-safe">
        <div className="animate-fadeIn flex flex-col items-center">
          <div className="w-20 h-20 bg-accent-primary rounded-full flex items-center justify-center text-white mb-4 shadow-xl">
            <div className="animate-fadeIn">
              <Check className="w-10 h-10" strokeWidth={3} />
            </div>
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">{t('addMint.addComplete')}</h2>
          <p className="text-foreground-muted">
            {recoveredAmount && recoveredAmount > 0
              ? t('addMint.recoveredTokens', { amount: recoveredAmount.toLocaleString() })
              : t('addMint.mintAddedSuccess')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-slideInUp h-dvh bg-background text-foreground flex flex-col font-sans relative overflow-hidden z-[60] pt-safe">
      {/* Header */}
      <header className="flex items-center justify-between px-3 pt-4 relative z-50">
        <div className="flex items-center">
          <button
            onClick={onBack}
            aria-label={t('common.back')}
            className="p-2 rounded-full bg-white/60 shadow-sm hover:shadow-md transition-all hover:bg-background-card backdrop-blur-md"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h2 className="text-base font-bold tracking-tight ml-3">{t('addMint.title')}</h2>
        </div>
        <span className={cn(
          "text-xs font-bold px-2 py-1 rounded-full",
          isAtLimit
            ? "bg-accent-danger/20 text-accent-danger"
            : "bg-primary/10 text-foreground-muted"
        )}>
          {displayMintCount}/{LIMITS.MAX_MINTS}
        </span>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Input Section */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-foreground-muted ml-2">{t('addMint.mintUrl')}</label>
          <div
            className={cn(
              'bg-white/60 p-3 rounded-xl border flex items-center gap-2 shadow-sm transition-all',
              error
                ? 'border-accent-danger/50 focus-within:ring-2 focus-within:ring-accent-danger/20'
                : 'border-white/50 focus-within:ring-2 focus-within:ring-primary/20'
            )}
          >
            <Search className="w-4 h-4 text-foreground-muted" />
            <input
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setError(null)
              }}
              placeholder={t('addMint.urlPlaceholder')}
              className="flex-1 bg-transparent outline-none font-medium placeholder:text-foreground-muted/50"
            />
          </div>
          {error && (
            <div className="flex items-center gap-2 text-accent-danger ml-2">
              <AlertCircle className="w-3 h-3" />
              <p className="text-[10px] font-medium">{error}</p>
            </div>
          )}
        </div>

        {/* Recommended Mints */}
        <div className="space-y-2">
          <label className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted ml-2">
            {t('addMint.recommended')}
          </label>
          <div className="space-y-2">
            {RECOMMENDED_MINTS.map((mint, i) => {
              const normalizedMintUrl = mint.url.replace(/\/$/, '')
              const isCurrentlyAdding = isAdding && (url === mint.url || url === normalizedMintUrl)
              const isAlreadyAdded = !isCurrentlyAdding && mints.some((m) => m === mint.url || m === normalizedMintUrl)
              const isSelected = url === mint.url

              return (
                <button
                  key={i}
                  onClick={() => !isAlreadyAdded && !isCurrentlyAdding && handleSelectRecommended(mint.url)}
                  disabled={isAlreadyAdded || isCurrentlyAdding}
                  className={cn(
                    'w-full p-3 rounded-xl border flex items-center justify-between group transition-all text-left',
                    isCurrentlyAdding
                      ? 'bg-primary/10 border-primary/30 cursor-default'
                      : isAlreadyAdded
                      ? 'bg-accent-primary/10 border-accent-primary/30 cursor-default'
                      : isSelected
                      ? 'bg-primary/10 border-primary/30'
                      : 'bg-white/40 hover:bg-white/60 border-white/30'
                  )}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-foreground">{mint.name}</h3>
                      {isCurrentlyAdding && (
                        <span className="text-[10px] font-bold text-foreground bg-primary/20 px-2 py-0.5 rounded-full">
                          {t('addMint.adding')}
                        </span>
                      )}
                      {isAlreadyAdded && (
                        <span className="text-[10px] font-bold text-accent-primary bg-accent-primary/20 px-2 py-0.5 rounded-full">
                          {t('addMint.added')}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-foreground-muted">{t(mint.descriptionKey)}</p>
                  </div>
                  {isCurrentlyAdding ? (
                    <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center">
                      <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                    </div>
                  ) : isAlreadyAdded ? (
                    <div className="w-6 h-6 rounded-full bg-accent-primary/20 flex items-center justify-center text-accent-primary">
                      <Check className="w-3 h-3" />
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'w-6 h-6 rounded-full flex items-center justify-center transition-opacity text-foreground',
                        isSelected
                          ? 'bg-primary/20 opacity-100'
                          : 'bg-primary/10 opacity-0 group-hover:opacity-100'
                      )}
                    >
                      <Plus className="w-3 h-3" />
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Discover More Mints */}
        <button
          onClick={handleOpenDiscovery}
          disabled={isAtLimit}
          className={cn(
            "w-full p-3 rounded-xl border flex items-center justify-between group transition-all",
            isAtLimit
              ? "bg-foreground-muted/10 border-foreground-muted/20 cursor-not-allowed opacity-50"
              : "bg-white/40 hover:bg-white/60 border-white/30"
          )}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Globe className="w-4 h-4 text-foreground" />
            </div>
            <div className="text-left">
              <h3 className="font-bold text-foreground text-sm">{t('addMint.discoverMints')}</h3>
              <p className="text-[10px] text-foreground-muted">{t('addMint.discoverDescription')}</p>
            </div>
          </div>
          <Search className="w-4 h-4 text-foreground-muted group-hover:text-foreground transition-colors" />
        </button>

        {isAtLimit && (
          <p className="text-[10px] text-accent-danger text-center">
            {t('settings.mintDeleteMaxReached')}
          </p>
        )}
      </div>

      {/* Bottom Action */}
      <div className="p-4 bg-gradient-to-t from-background to-transparent pt-8 pb-safe">
        <button
          onClick={handleAdd}
          disabled={!url || isAdding}
          className={cn(
            'w-full p-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg',
            url
              ? 'bg-primary text-primary-foreground hover:bg-primary-hover shadow-primary/20'
              : 'bg-foreground-muted/20 text-foreground-muted cursor-not-allowed'
          )}
        >
          {isAdding ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>{progressStep ? progressMessages[progressStep] : t('common.processing')}</span>
            </>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              <span>{t('settings.addMint')}</span>
            </>
          )}
        </button>
      </div>

      {/* Mint Discovery Modal */}
        {isDiscoveryOpen && (
          <div
            className="animate-fadeIn fixed inset-0 bg-black/50 z-[100] flex items-end justify-center"
            onClick={() => setIsDiscoveryOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="animate-slideInUp bg-background w-full max-h-[80vh] rounded-t-3xl flex flex-col"
            >
              {/* Handle */}
              <div className="flex justify-center py-3">
                <div className="w-10 h-1 bg-primary/20 rounded-full" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-4 pb-3">
                <h3 className="text-base font-bold text-foreground">{t('addMint.worldwide')}</h3>
                <button
                  onClick={() => setIsDiscoveryOpen(false)}
                  aria-label={t('common.close')}
                  className="p-2 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors"
                >
                  <X className="w-4 h-4 text-foreground" />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto px-4 pb-safe">
                {isLoadingDiscovery ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <Loader2 className="w-8 h-8 text-foreground animate-spin mb-3" />
                    <p className="text-sm text-foreground-muted">{t('addMint.loading')}</p>
                  </div>
                ) : discoveryError ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <AlertCircle className="w-8 h-8 text-accent-danger mb-3" />
                    <p className="text-sm text-accent-danger">{discoveryError}</p>
                    <button
                      onClick={handleOpenDiscovery}
                      className="mt-3 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium"
                    >
                      {t('common.retry')}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2 pb-4">
                    <p className="text-[10px] text-foreground-muted mb-3">
                      {t('addMint.auditDescription')}
                    </p>
                    {discoveredMints.map((mint, i) => {
                      const normalizedMintUrl = normalizeMintUrl(mint.url)
                      const isAlreadyAdded = mints.some(
                        (m) => m === mint.url || m === normalizedMintUrl
                      )
                      const totalTx = mint.n_mints + mint.n_melts

                      return (
                        <button
                          key={i}
                          onClick={() => !isAlreadyAdded && !isAtLimit && handleSelectDiscovered(mint.url)}
                          disabled={isAlreadyAdded || isAtLimit}
                          className={cn(
                            'w-full p-3 rounded-xl border flex items-center justify-between transition-all text-left',
                            isAlreadyAdded
                              ? 'bg-accent-primary/10 border-accent-primary/30 cursor-default'
                              : isAtLimit
                              ? 'bg-foreground-muted/10 border-foreground-muted/20 cursor-not-allowed opacity-50'
                              : 'bg-white/40 hover:bg-white/60 border-white/30'
                          )}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-bold text-foreground text-sm truncate">
                                {mint.name || new URL(mint.url).hostname}
                              </h4>
                              {isAlreadyAdded && (
                                <span className="text-[10px] font-bold text-accent-primary bg-accent-primary/20 px-2 py-0.5 rounded-full shrink-0">
                                  {t('addMint.added')}
                                </span>
                              )}
                            </div>
                            <p className="text-[10px] text-foreground-muted truncate">{mint.url}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <TrendingUp className="w-3 h-3 text-foreground-muted" />
                              <span className="text-[10px] text-foreground-muted">
                                {t('addMint.transactions', { count: totalTx })}
                              </span>
                            </div>
                          </div>
                          {isAlreadyAdded ? (
                            <div className="w-6 h-6 rounded-full bg-accent-primary/20 flex items-center justify-center text-accent-primary shrink-0 ml-2">
                              <Check className="w-3 h-3" />
                            </div>
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-foreground shrink-0 ml-2">
                              <Plus className="w-3 h-3" />
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  )
}

export default AddMintScreen
