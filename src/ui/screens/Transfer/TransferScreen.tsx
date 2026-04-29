import { useState, useCallback, useMemo } from 'react'

import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/ui/lib/utils'
import { ProgressStepper } from '@/ui/components/common/ProgressStepper'
import { useAppStore } from '@/store'
import { usePayment, useWallet, useMintMetadata } from '@/ui/hooks'
import { useSatUnit, useFormatSats, useFormatFiat } from '@/utils/format'
import { MintCard, getVariantByIndex } from '@/ui/components/wallet/MintCard'
import type { MintInfo } from '@/core/types'
import { getMintBalance as getMintBalanceUtil } from '@/utils/url'
import { MintIcon } from '@/ui/screens/Settings/SettingsHelpers'

export interface TransferScreenProps {
  onBack: () => void
  onTransactionComplete?: () => void
  initialFromMintUrl?: string
}

type TransferStatus = 'idle' | 'processing' | 'success'
type ProgressStep = 'quoting' | 'melting' | 'minting' | null

const PROGRESS_ORDER: Exclude<ProgressStep, null>[] = ['quoting', 'melting', 'minting']

export function TransferScreen({ onBack, onTransactionComplete, initialFromMintUrl }: TransferScreenProps) {
  const { t } = useTranslation()
  const unit = useSatUnit()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const mintUrls = useAppStore((s) => s.settings.mints)
  const balance = useAppStore((s) => s.balance)
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)
  const { mintSwap, isProcessingPayment } = usePayment()
  const { loadBalance } = useWallet()

  const [amount, setAmount] = useState('')
  const [isDrain, setIsDrain] = useState(false)
  const [status, setStatus] = useState<TransferStatus>('idle')
  const [progressStep, setProgressStep] = useState<ProgressStep>(null)
  const [error, setError] = useState<string | null>(null)
  const [transferredAmount, setTransferredAmount] = useState(0)

  const resolvedInitialFrom = initialFromMintUrl && mintUrls.includes(initialFromMintUrl) ? initialFromMintUrl : (mintUrls[0] || '')
  const resolvedInitialTo = mintUrls.find(u => u !== resolvedInitialFrom) || mintUrls[0] || ''
  const [fromMintUrl, setFromMintUrl] = useState<string>(resolvedInitialFrom)
  const [toMintUrl, setToMintUrl] = useState<string>(resolvedInitialTo)
  const [isMintSelectorOpen, setIsMintSelectorOpen] = useState<'from' | 'to' | null>(null)

  const getMintBalance = useCallback((url: string) =>
    getMintBalanceUtil(url, balance.byMint)
  , [balance.byMint])

  const currentBalance = fromMintUrl ? getMintBalance(fromMintUrl) : 0
  const numericAmount = parseInt(amount) || 0
  const isInsufficientFunds = numericAmount > currentBalance

  const fromMintInfo = useMemo(() => fromMintUrl ? ({
    url: fromMintUrl,
    alias: getDisplayName(fromMintUrl),
    iconUrl: getIconUrl(fromMintUrl),
    balance: getMintBalance(fromMintUrl),
    isOnline: true,
  } satisfies MintInfo) : null, [fromMintUrl, getDisplayName, getIconUrl, getMintBalance])

  const toMintInfo = useMemo(() => toMintUrl ? ({
    url: toMintUrl,
    alias: getDisplayName(toMintUrl),
    iconUrl: getIconUrl(toMintUrl),
    balance: getMintBalance(toMintUrl),
    isOnline: true,
  } satisfies MintInfo) : null, [toMintUrl, getDisplayName, getIconUrl, getMintBalance])

  const fromVariant = getVariantByIndex(mintUrls.indexOf(fromMintUrl))
  const toVariant = getVariantByIndex(mintUrls.indexOf(toMintUrl))

  const handleSwapMints = useCallback(() => {
    setFromMintUrl(toMintUrl)
    setToMintUrl(fromMintUrl)
  }, [fromMintUrl, toMintUrl])

  const handleTransferAll = useCallback(() => {
    setAmount(String(currentBalance))
    setIsDrain(true)
  }, [currentBalance])

  const handleAmountChange = useCallback((val: string) => {
    setAmount(val)
    setIsDrain(false)
  }, [])

  const handleAction = useCallback(async () => {
    if (isInsufficientFunds || numericAmount <= 0) return

    if (!fromMintUrl || !toMintUrl || fromMintUrl === toMintUrl) {
      setError(t('transfer.sameMintsError'))
      return
    }

    setStatus('processing')
    setError(null)
    setProgressStep('quoting')

    try {
      setProgressStep('melting')
      const result = await mintSwap(fromMintUrl, toMintUrl, numericAmount, isDrain ? { drain: true } : undefined)

      if (result) {
        setProgressStep('minting')
        await loadBalance()
        setTransferredAmount(result.amount)
        setProgressStep(null)
        setStatus('success')
        onTransactionComplete?.()
        setTimeout(() => onBack(), 3000)
      } else {
        setStatus('idle')
        setProgressStep(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.generic'))
      setStatus('idle')
      setProgressStep(null)
    }
  }, [isInsufficientFunds, numericAmount, fromMintUrl, toMintUrl, isDrain, mintSwap, loadBalance, onTransactionComplete, onBack, t])

  const progressMessages = useMemo<Record<Exclude<ProgressStep, null>, string>>(() => ({
    quoting: t('transfer.quoting'),
    melting: t('transfer.melting'),
    minting: t('transfer.minting'),
  }), [t])

  // Processing / Success — full screen
  if (status === 'processing' || status === 'success') {
    return (
      <div className="h-dvh bg-background text-foreground flex flex-col pt-safe pb-safe z-[60]">
        <header className="flex items-center justify-center px-5 h-14 shrink-0">
          <h2 className="text-heading font-bold text-foreground">{t('transfer.title')}</h2>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center px-6">
          {status === 'success' ? (
            <div className="animate-fadeIn flex flex-col items-center text-center">
              {/* Two cards side by side */}
              <div className="flex items-center gap-3 mb-6" style={{ ['--card-w' as string]: 'clamp(120px, 35vw, 150px)' }}>
                {fromMintInfo && (
                  <div className="animate-cardFlipIn">
                    <MintCard mint={fromMintInfo} variant={fromVariant} hideBalance />
                  </div>
                )}
                <ArrowRightLeft className="w-5 h-5 text-brand shrink-0" />
                {toMintInfo && (
                  <div className="animate-cardFlipIn" style={{ animationDelay: '0.2s' }}>
                    <MintCard mint={toMintInfo} variant={toVariant} hideBalance />
                  </div>
                )}
              </div>
              <h3 className="text-body font-bold text-foreground mb-1">{t('transfer.transferComplete')}</h3>
              <p className="text-caption font-semibold text-brand">{formatSats(transferredAmount)}</p>
              {(() => { const f = formatFiat(transferredAmount); return f ? <p className="text-label font-medium text-foreground-muted mt-0.5">{f}</p> : null })()}
            </div>
          ) : (
            <div className="flex flex-col items-center text-center">
              <div className="w-12 h-12 border-3 border-brand/20 border-t-brand rounded-full animate-spin mb-6" />
              <p className="text-body font-semibold text-foreground mb-1">
                {getDisplayName(fromMintUrl)} → {getDisplayName(toMintUrl)}
              </p>
              <p className="text-caption font-bold text-brand mb-6">{formatSats(numericAmount)}</p>
              <ProgressStepper steps={PROGRESS_ORDER} currentStep={progressStep} labels={progressMessages} />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="h-dvh bg-background text-foreground flex flex-col font-primary relative overflow-hidden z-[60] pt-safe">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h2 className="absolute inset-0 flex items-center justify-center px-16 text-center text-heading font-bold text-foreground pointer-events-none truncate">{t('transfer.title')}</h2>
        <div className="w-10" />
      </header>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-28">
        {/* From Mint Row */}
        <button
          onClick={() => setIsMintSelectorOpen('from')}
          className="w-full px-4 py-3 rounded-xl bg-background-card flex items-center gap-3 active:bg-background-hover transition-colors"
        >
          <MintIcon url={fromMintUrl} getIconUrl={getIconUrl} size="sm" />
          <div className="flex-1 min-w-0 text-left">
            <p className="text-caption font-medium uppercase tracking-wide text-foreground-muted">{t('transfer.from')}</p>
            <p className="text-caption font-medium text-foreground truncate">{getDisplayName(fromMintUrl)}</p>
          </div>
          <span className="text-caption font-medium text-foreground-muted shrink-0">{formatSats(currentBalance)}</span>
          <ChevronRight className="w-4 h-4 text-foreground-subtle shrink-0" />
        </button>

        {/* Swap Button */}
        <div className="flex justify-center my-2">
          <button
            onClick={handleSwapMints}
            className="w-9 h-9 bg-brand rounded-full flex items-center justify-center text-white active:scale-95 transition-transform"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* To Mint Row */}
        <button
          onClick={() => setIsMintSelectorOpen('to')}
          className="w-full px-4 py-3 rounded-xl bg-background-card flex items-center gap-3 active:bg-background-hover transition-colors"
        >
          <MintIcon url={toMintUrl} getIconUrl={getIconUrl} size="sm" />
          <div className="flex-1 min-w-0 text-left">
            <p className="text-caption font-medium uppercase tracking-wide text-foreground-muted">{t('transfer.to')}</p>
            <p className="text-caption font-medium text-foreground truncate">{getDisplayName(toMintUrl)}</p>
          </div>
          <span className="text-caption font-medium text-foreground-muted shrink-0">{formatSats(toMintUrl ? getMintBalance(toMintUrl) : 0)}</span>
          <ChevronRight className="w-4 h-4 text-foreground-subtle shrink-0" />
        </button>

        {/* Amount Input */}
        <div className={cn(
          'mt-6 p-6 rounded-2xl border flex flex-col items-center justify-center gap-3 transition-all',
          isInsufficientFunds
            ? 'bg-accent-danger/5 border-accent-danger/30'
            : 'bg-foreground/[0.02] border-border'
        )}>
          <span className={cn(
            'text-caption font-semibold uppercase tracking-wide',
            isInsufficientFunds ? 'text-accent-danger' : 'text-foreground-muted'
          )}>
            {isInsufficientFunds ? t('payment.insufficientBalance') : t('common.amount')}
          </span>
          <div className="flex items-center justify-center gap-1.5 w-full">
            {unit === '₿' && (
              <span className={cn('text-display font-bold font-display', isInsufficientFunds ? 'text-accent-danger' : 'text-foreground-muted')}>
                {unit}
              </span>
            )}
            <input
              type="text"
              inputMode="numeric"
              value={amount ? parseInt(amount).toLocaleString() : ''}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9]/g, '')
                if (Number(val) > 2_100_000_000_000_000) return
                handleAmountChange(val)
              }}
              placeholder="0"
              className={cn(
                'bg-transparent text-display font-bold font-display text-center outline-none placeholder:text-foreground/20 min-w-[1ch] w-auto',
                isInsufficientFunds ? 'text-accent-danger' : 'text-foreground'
              )}
              style={{ width: amount ? `${amount.length + 1}ch` : '2ch' }}
            />
            {unit !== '₿' && (
              <span className={cn('text-display font-bold font-display', isInsufficientFunds ? 'text-accent-danger' : 'text-foreground-muted')}>
                {unit}
              </span>
            )}
          </div>
          {(() => { const f = formatFiat(numericAmount); return f ? <p className="text-caption text-foreground-muted">{f}</p> : null })()}
          {isInsufficientFunds && (
            <p className="text-caption font-semibold text-accent-danger">
              {t('payment.maxAmount', { amount: formatSats(currentBalance) })}
            </p>
          )}
          {!isInsufficientFunds && currentBalance > 0 && (
            <button
              onClick={handleTransferAll}
              className={cn(
                'text-caption font-semibold px-4 py-1.5 rounded-full transition-colors mt-1',
                isDrain
                  ? 'bg-brand text-white'
                  : 'bg-foreground/[0.06] text-foreground-muted active:bg-foreground/10'
              )}
            >
              {t('transfer.transferAll')} ({formatSats(currentBalance)})
            </button>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-3 flex items-center justify-center gap-1.5 text-accent-danger">
            <p className="text-label font-medium">{error}</p>
          </div>
        )}
      </div>

      {/* Footer Action */}
      <div className="absolute bottom-0 left-0 right-0 p-4 pb-safe bg-background border-t border-border z-50">
        <button
          onClick={handleAction}
          disabled={isInsufficientFunds || numericAmount <= 0 || isProcessingPayment || fromMintUrl === toMintUrl}
          className={cn(
            'w-full py-3.5 rounded-[14px] font-semibold text-caption flex items-center justify-center gap-2 transition-colors',
            isInsufficientFunds || numericAmount <= 0 || isProcessingPayment || fromMintUrl === toMintUrl
              ? 'bg-foreground/10 text-foreground-muted cursor-not-allowed'
              : 'bg-brand text-white active:opacity-80'
          )}
        >
          {isProcessingPayment ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('transfer.swapping')}
            </>
          ) : (
            <>
              <ArrowRightLeft className="w-4 h-4" />
              {t('transfer.swap')}
            </>
          )}
        </button>
      </div>

      {/* Mint Selector Modal */}
      {isMintSelectorOpen && (
        <div
          className="animate-fadeIn fixed inset-0 bg-black/40 z-[70] flex items-end justify-center"
          onClick={() => setIsMintSelectorOpen(null)}
        >
          <div
            className="animate-slideInUp bg-background w-full rounded-t-2xl overflow-hidden shadow-2xl pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-3 border-b border-border">
              <h3 className="text-caption font-semibold text-foreground">{t('payment.selectMint')}</h3>
            </div>
            <div className="p-2 flex flex-col gap-1 max-h-[50vh] overflow-y-auto">
              {mintUrls.map((url) => {
                const mintBalance = getMintBalance(url)
                const isSelected =
                  (isMintSelectorOpen === 'from' && url === fromMintUrl) ||
                  (isMintSelectorOpen === 'to' && url === toMintUrl)
                const isDisabled = isMintSelectorOpen === 'to' && url === fromMintUrl

                return (
                  <button
                    key={url}
                    onClick={() => {
                      if (isMintSelectorOpen === 'from') setFromMintUrl(url)
                      if (isMintSelectorOpen === 'to') setToMintUrl(url)
                      setIsMintSelectorOpen(null)
                    }}
                    disabled={isDisabled}
                    className={cn(
                      'px-4 py-3 rounded-xl flex items-center gap-3 transition-colors',
                      isSelected
                        ? 'bg-foreground text-background-card'
                        : 'active:bg-background-hover disabled:opacity-40 disabled:cursor-not-allowed'
                    )}
                  >
                    <MintIcon url={url} getIconUrl={getIconUrl} size="sm" />
                    <div className="flex-1 min-w-0 text-left">
                      <span className={cn('text-caption font-medium truncate block', isSelected ? 'text-background-card' : 'text-foreground')}>
                        {getDisplayName(url)}
                      </span>
                      <span className={cn('text-overline font-medium', isSelected ? 'text-background-card/70' : 'text-foreground-muted')}>
                        {formatSats(mintBalance)}
                      </span>
                    </div>
                    {isSelected && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default TransferScreen
