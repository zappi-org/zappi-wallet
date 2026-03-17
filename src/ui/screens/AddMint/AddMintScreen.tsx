import { useState, useCallback, useRef, useEffect } from 'react'

import { ArrowLeft, Plus, Check, AlertCircle, TrendingUp, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { mintMetadataService } from '@/services/mint-metadata'
import { restoreWallet, getBalances } from '@/coco'
import { normalizeMintUrl } from '@/utils/url'
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

  const settings = useAppStore((s) => s.settings)
  const mints = settings.mints
  const setBalance = useAppStore((s) => s.setBalance)

  const mintCountBeforeAdd = useRef(mints.length)
  const displayMintCount = isAdding ? mintCountBeforeAdd.current : mints.length
  const isAtLimit = displayMintCount >= LIMITS.MAX_MINTS

  const progressMessages: Record<Exclude<ProgressStep, null>, string> = {
    validating: t('addMint.validating'),
    adding: t('addMint.adding'),
    restoring: t('addMint.restoring'),
  }

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
  }, [t])

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
    const displayName = mintName || (() => { try { return new URL(targetUrl).hostname } catch { return targetUrl } })()
    setAddingMintName(displayName)
    setAddingMintUrl(normalizedUrl)
    setIsAdding(true)
    setError(null)
    setProgressStep('validating')

    try {
      const metadata = await mintMetadataService.fetchAndCache(normalizedUrl)
      if (!metadata) {
        throw new Error(t('addMint.addFailed'))
      }
      setAddingMintIconUrl(metadata.iconUrl)

      setProgressStep('adding')

      const newMints = [...mints, normalizedUrl]
      const existingAliases = settings.mintAliases || {}
      const nextNumber = Object.keys(existingAliases).length + 1
      const alias = t('mintDetail.defaultName', { number: nextNumber })
      const newAliases = { ...existingAliases, [normalizedUrl]: alias }
      setAddingMintAlias(alias)
      if (onSaveSettings) {
        await onSaveSettings({ mints: newMints, mintAliases: newAliases })
      }

      setProgressStep('restoring')

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
  }, [url, mints, isAtLimit, onSaveSettings, onBack, onSuccess, setBalance, t, settings.mintAliases])

  // Full-screen progress view (adding or success)
  if (isAdding || success) {
    const currentStepIndex = progressStep ? PROGRESS_ORDER.indexOf(progressStep) : PROGRESS_ORDER.length

    return (
      <div className="h-dvh bg-background text-foreground flex flex-col pt-safe pb-safe z-[60]">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border">
          <div className="p-1 w-7" />
          <h2 className="text-base font-semibold tracking-tight flex-1 text-center">{t('addMint.title')}</h2>
          <div className="w-7" />
        </header>

        <div className="flex-1 flex flex-col items-center justify-center px-6">
          {success ? (() => {
            const cardMintInfo: MintInfo = {
              url: addingMintUrl || '',
              alias: addingMintAlias || undefined,
              mintName: addingMintName || undefined,
              iconUrl: addingMintIconUrl,
              balance: recoveredAmount || 0,
              isOnline: true,
            }
            const variantIndex = mintCountBeforeAdd.current
            return (
              <div className="animate-fadeIn flex flex-col items-center text-center">
                <div className="animate-cardFlipIn mb-6" style={{ perspective: '800px' }}>
                  <MintCard
                    mint={cardMintInfo}
                    variant={getVariantByIndex(variantIndex)}
                    hideBalance={false}
                  />
                </div>
                <h3 className="text-[16px] font-bold text-foreground mb-1">
                  <span className="text-[#3b7df5]">{addingMintAlias || addingMintName}</span>
                  {t('addMint.hasBeenAdded')}
                </h3>
                {recoveredAmount && recoveredAmount > 0 && (
                  <p className="text-[13px] text-foreground-muted">
                    {t('addMint.recoveredTokens', { amount: formatSats(recoveredAmount) })}
                  </p>
                )}
              </div>
            )
          })() : (
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 border-3 border-[#3b7df5]/20 border-t-[#3b7df5] rounded-full animate-spin mb-6" />
              <p className="text-[18px] font-bold text-[#3b7df5] mb-1">{addingMintName}</p>
              <p className="text-[13px] text-foreground-muted mb-6">
                {(() => { try { return new URL(addingMintUrl || '').hostname } catch { return addingMintUrl } })()}
              </p>
              <div className="inline-flex flex-col space-y-3">
                {PROGRESS_ORDER.map((step, i) => {
                  const isDone = currentStepIndex > i
                  const isCurrent = currentStepIndex === i
                  return (
                    <div key={step} className="flex items-center gap-2.5">
                      <div className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-colors',
                        isDone ? 'bg-[#3b7df5]' : isCurrent ? 'bg-[#3b7df5]' : 'bg-foreground/10'
                      )}>
                        {isDone ? (
                          <Check className="w-3 h-3 text-white" strokeWidth={3} />
                        ) : isCurrent ? (
                          <div className="w-2 h-2 bg-white rounded-full" />
                        ) : (
                          <span className="text-[10px] font-bold text-foreground-muted">{i + 1}</span>
                        )}
                      </div>
                      <span className={cn(
                        'text-[13px]',
                        isDone ? 'text-foreground-muted' : isCurrent ? 'text-foreground font-medium' : 'text-foreground-muted/50'
                      )}>
                        {progressMessages[step]}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="animate-slideInUp h-dvh bg-background text-foreground flex flex-col font-sans relative overflow-hidden z-[60] pt-safe">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border">
        <button onClick={onBack} aria-label={t('common.back')} className="p-1">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h2 className="text-base font-semibold tracking-tight flex-1">{t('addMint.title')}</h2>
        <span className={cn(
          "text-[11px] font-semibold",
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
            className="flex-1 px-3 py-2.5 rounded-sm bg-background border border-border text-[13px] focus:outline-none focus:ring-1 focus:ring-foreground/20 placeholder:text-foreground-muted/50"
          />
          <button
            onClick={() => handleAdd()}
            disabled={!url || isAtLimit}
            className={cn(
              'px-4 py-2.5 rounded-sm font-semibold text-[13px] shrink-0 transition-colors',
              url && !isAtLimit
                ? 'bg-foreground text-background-card active:opacity-80'
                : 'bg-foreground/10 text-foreground-muted cursor-not-allowed'
            )}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-1.5 text-accent-danger ml-1">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <p className="text-[11px] font-medium">{error}</p>
          </div>
        )}
        {isAtLimit && (
          <p className="text-[11px] text-accent-danger ml-1">
            {t('settings.mintDeleteMaxReached')}
          </p>
        )}
      </div>

      {/* Global Mint List */}
      <div className="flex-1 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted px-4 pt-3 pb-2">
          {t('addMint.worldwide')}
        </p>

        {isLoadingDiscovery ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-foreground-muted animate-spin mb-2" />
            <p className="text-[12px] text-foreground-muted">{t('addMint.loading')}</p>
          </div>
        ) : discoveryError ? (
          <div className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="w-6 h-6 text-accent-danger mb-2" />
            <p className="text-[12px] text-accent-danger mb-3">{discoveryError}</p>
            <button
              onClick={handleRetryDiscovery}
              className="px-4 py-2 bg-foreground text-background-card rounded-sm text-[12px] font-semibold active:opacity-80"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : (
          <div className="bg-background-card divide-y divide-border pb-safe">
            {discoveredMints.map((mint, i) => {
              const normalizedMintUrl = normalizeMintUrl(mint.url)
              const isAlreadyAdded = mints.some(
                (m) => m === mint.url || m === normalizedMintUrl
              )
              const totalTx = mint.n_mints + mint.n_melts
              const displayName = mint.name || (() => { try { return new URL(mint.url).hostname } catch { return mint.url } })()

              return (
                <div
                  key={i}
                  className={cn(
                    'w-full px-4 py-3 flex items-center gap-3',
                    (isAlreadyAdded || isAtLimit) && 'opacity-50'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {displayName}
                      </span>
                      {isAlreadyAdded && (
                        <Check className="w-3.5 h-3.5 text-accent-primary shrink-0" />
                      )}
                    </div>
                    <span className="text-[11px] text-foreground-muted truncate block">
                      {mint.url.replace('https://', '')}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <TrendingUp className="w-3 h-3 text-foreground-muted" />
                      <span className="text-[10px] text-foreground-muted">
                        {t('addMint.transactions', { count: totalTx })}
                      </span>
                    </div>
                  </div>
                  {!isAlreadyAdded && !isAtLimit && (
                    <button
                      onClick={() => handleAdd(mint.url, displayName)}
                      className="w-8 h-8 flex items-center justify-center rounded-sm bg-foreground/[0.06] active:bg-foreground/15 shrink-0"
                    >
                      <Plus className="w-4 h-4 text-foreground-muted" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default AddMintScreen
