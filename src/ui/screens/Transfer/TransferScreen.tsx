import { useState, useCallback, useMemo } from 'react'

import {
  ArrowLeft,
  ArrowRightLeft,
  ChevronDown,
  Loader2,
  RefreshCw,
  Zap,
  Check,
  CheckCircle2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { usePayment, useWallet, useMintMetadata } from '@/hooks'
import { useSatUnit, useFormatSats, useFormatFiat } from '@/utils/format'
import cardLogo from '@/assets/card-logo.svg'

export interface TransferScreenProps {
  onBack: () => void
  onTransactionComplete?: () => void
  initialFromMintUrl?: string
}

type TransferTab = 'swap' | 'melt'
type TransferStatus = 'idle' | 'processing' | 'success' | 'error'

// Mint icon component with fallback
function MintIcon({
  url,
  getIconUrl,
  size = 'md',
  className = ''
}: {
  url: string | null
  getIconUrl: (url: string) => string | undefined
  size?: 'sm' | 'md'
  className?: string
}) {
  const iconUrl = url ? getIconUrl(url) : undefined
  const sizeClasses = size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'
  const fallbackIconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5'

  // With icon URL - show as circular image
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        className={cn(sizeClasses, 'rounded-full object-cover shadow-md', className)}
        onError={(e) => {
          // On error, replace with fallback
          e.currentTarget.style.display = 'none'
          e.currentTarget.nextElementSibling?.classList.remove('hidden')
        }}
      />
    )
  }

  // Fallback - gradient background with card logo (matching home screen style)
  return (
    <div className={cn(sizeClasses, 'rounded-full bg-gradient-to-br from-primary to-accent-primary flex items-center justify-center shadow-md', className)}>
      <img src={cardLogo} alt="" className={cn(fallbackIconSize, 'object-contain invert opacity-90')} />
    </div>
  )
}

export function TransferScreen({ onBack, onTransactionComplete, initialFromMintUrl }: TransferScreenProps) {
  const { t } = useTranslation()
  const unit = useSatUnit()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  // Get mint URLs from settings (the actual source of truth)
  const mintUrls = useAppStore((s) => s.settings.mints)
  const balance = useAppStore((s) => s.balance)
  const { getDisplayName, getIconUrl } = useMintMetadata(mintUrls)
  const { mintSwap, sendLightning, isProcessingPayment } = usePayment()
  const { loadBalance } = useWallet()

  const [activeTab, setActiveTab] = useState<TransferTab>('swap')
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState<TransferStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // Swap State — respect initialFromMintUrl if provided
  const resolvedInitialFrom = initialFromMintUrl && mintUrls.includes(initialFromMintUrl) ? initialFromMintUrl : (mintUrls[0] || '')
  const resolvedInitialTo = mintUrls.find(u => u !== resolvedInitialFrom) || mintUrls[0] || ''
  const [fromMintUrl, setFromMintUrl] = useState<string>(resolvedInitialFrom)
  const [toMintUrl, setToMintUrl] = useState<string>(resolvedInitialTo)

  // Melt State
  const [lnAddress, setLnAddress] = useState('')
  const [isMintSelectorOpen, setIsMintSelectorOpen] = useState<'from' | 'to' | null>(null)

  // Get mint info
  const fromMint = useMemo(() => {
    if (!fromMintUrl || !mintUrls.includes(fromMintUrl)) return null
    // Normalize URL for balance lookup (remove trailing slash)
    const normalizedUrl = fromMintUrl.endsWith('/') ? fromMintUrl.slice(0, -1) : fromMintUrl
    const mintBalance = balance.byMint[normalizedUrl] || balance.byMint[fromMintUrl] || 0
    return { url: fromMintUrl, name: getDisplayName(fromMintUrl), balance: mintBalance }
  }, [mintUrls, fromMintUrl, balance.byMint, getDisplayName])

  const toMint = useMemo(() => {
    if (!toMintUrl || !mintUrls.includes(toMintUrl)) return null
    // Normalize URL for balance lookup (remove trailing slash)
    const normalizedUrl = toMintUrl.endsWith('/') ? toMintUrl.slice(0, -1) : toMintUrl
    const mintBalance = balance.byMint[normalizedUrl] || balance.byMint[toMintUrl] || 0
    return { url: toMintUrl, name: getDisplayName(toMintUrl), balance: mintBalance }
  }, [mintUrls, toMintUrl, balance.byMint, getDisplayName])

  const currentBalance = fromMint?.balance || 0
  const numericAmount = parseInt(amount) || 0
  const isInsufficientFunds = numericAmount > currentBalance

  const handleSwapMints = useCallback(() => {
    setFromMintUrl(toMintUrl)
    setToMintUrl(fromMintUrl)
  }, [fromMintUrl, toMintUrl])

  const handleAction = useCallback(async () => {
    if (isInsufficientFunds || numericAmount <= 0) return

    // Validate inputs
    if (activeTab === 'swap') {
      if (!fromMintUrl || !toMintUrl || fromMintUrl === toMintUrl) {
        setError(t('transfer.sameMintsError'))
        return
      }
    } else {
      if (!lnAddress.trim()) {
        setError(t('settings.lightningAddress'))
        return
      }
    }

    setStatus('processing')
    setError(null)

    try {
      if (activeTab === 'swap') {
        // Mint swap via Lightning
        const result = await mintSwap(fromMintUrl, toMintUrl, numericAmount)
        if (result) {
          await loadBalance() // Refresh balance
          setStatus('success')
          onTransactionComplete?.()
        } else {
          // Error toast is already shown by the hook with detailed message
          setStatus('idle')
        }
      } else {
        // Melt to Lightning address/invoice
        const result = await sendLightning(lnAddress.trim(), numericAmount, fromMintUrl)
        if (result) {
          await loadBalance() // Refresh balance
          setStatus('success')
          onTransactionComplete?.()
        } else {
          // Error toast is already shown by the hook with detailed message
          setStatus('idle')
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.generic'))
      setStatus('error')
    }
  }, [isInsufficientFunds, numericAmount, activeTab, fromMintUrl, toMintUrl, lnAddress, mintSwap, sendLightning, loadBalance, onTransactionComplete, t])

  const handleDone = useCallback(() => {
    setStatus('idle')
    setAmount('')
    onBack()
  }, [onBack])


  // Success Screen
  if (status === 'success') {
    return (
      <div className="animate-fadeIn h-dvh bg-background flex flex-col items-center justify-center p-4 text-center relative overflow-hidden pt-safe pb-safe">
        <div className="animate-fadeIn relative z-10 flex flex-col items-center">
          <div className="w-20 h-20 bg-primary rounded-full flex items-center justify-center text-primary-foreground mb-4 shadow-[0_10px_40px_rgba(38,64,50,0.3)]">
            <div className="animate-fadeIn">
              <CheckCircle2 className="w-10 h-10" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2 tracking-tight">
            {activeTab === 'swap' ? t('transfer.swapComplete') : t('payment.paymentSuccess')}
          </h2>
          <div className="bg-white/60 px-4 py-2 rounded-full border border-white/50 mb-2 shadow-sm">
            <p className="text-foreground font-bold text-base">
              {formatSats(Number(amount))}
            </p>
          </div>
          {(() => { const f = formatFiat(Number(amount)); return f ? (
            <p className="text-sm text-foreground-muted mb-6">≈ {f}</p>
          ) : null })()}
          <button
            onClick={handleDone}
            className="w-full max-w-[200px] bg-primary text-white py-3 rounded-2xl font-bold hover:bg-primary-hover transition-colors shadow-lg"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-dvh bg-background text-foreground flex flex-col font-sans relative overflow-hidden z-[60] pt-safe">
      {/* Background blobs */}
      <div className="absolute top-[-20%] right-[-20%] w-[60vh] h-[60vh] bg-accent-primary/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[50vh] h-[50vh] bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="flex items-center px-3 pt-4 relative z-50">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="p-2 rounded-full bg-white/60 shadow-sm hover:shadow-md transition-all hover:bg-background-card backdrop-blur-md"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
      </header>

      {/* Tabs */}
      <div className="px-4 mt-3 mb-4 relative z-40">
        <div className="bg-primary/10 p-1 rounded-full flex relative">
          {/* Sliding Background */}
          <div
            className={cn(
              'absolute top-1 bottom-1 rounded-full bg-white shadow-sm transition-all duration-250 ease-out',
              activeTab === 'swap'
                ? 'left-1 w-[calc(50%-4px)]'
                : 'left-[calc(50%+2px)] w-[calc(50%-4px)]'
            )}
          />

          <button
            onClick={() => setActiveTab('swap')}
            className={cn(
              'flex-1 py-2 rounded-full text-xs font-bold relative z-10 transition-colors flex items-center justify-center gap-2',
              activeTab === 'swap'
                ? 'text-foreground'
                : 'text-foreground-muted hover:text-foreground'
            )}
          >
            <RefreshCw className="w-3 h-3" />
            {t('history.swap')}
          </button>
          <button
            onClick={() => setActiveTab('melt')}
            className={cn(
              'flex-1 py-2 rounded-full text-xs font-bold relative z-10 transition-colors flex items-center justify-center gap-2',
              activeTab === 'melt'
                ? 'text-foreground'
                : 'text-foreground-muted hover:text-foreground'
            )}
          >
            <Zap className="w-3 h-3" />
            {t('amountAction.lightning')}
          </button>
        </div>
      </div>

      <div className="flex-1 px-4 flex flex-col gap-4 overflow-y-auto pb-20 relative z-40">
          {activeTab === 'swap' ? (
            <div className="animate-fadeIn flex flex-col gap-2">

              {/* From Mint */}
              <div
                onClick={() => setIsMintSelectorOpen('from')}
                className="bg-white/60 p-4 rounded-2xl border border-white/50 shadow-sm relative cursor-pointer active:scale-[0.98] transition-all"
              >
                <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider mb-2 block">
                  {t('transfer.from')}
                </span>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <MintIcon url={fromMintUrl} getIconUrl={getIconUrl} />
                    <div className="flex flex-col">
                      <span className="font-bold text-foreground text-sm">
                        {fromMint ? fromMint.name : t('payment.selectMint')}
                      </span>
                      <span className="text-[10px] text-foreground-muted">
                        {t('common.balance')}: {formatSats(fromMint?.balance || 0)}
                      </span>
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-foreground-muted" />
                </div>
              </div>

              {/* Swap Button Indicator */}
              <div className="h-5 relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSwapMints()
                  }}
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground shadow-lg border-4 border-background z-20 hover:scale-110 transition-transform"
                >
                  <ArrowRightLeft className="w-3 h-3" />
                </button>
              </div>

              {/* To Mint */}
              <div
                onClick={() => setIsMintSelectorOpen('to')}
                className="bg-white/60 p-4 rounded-2xl border border-white/50 shadow-sm cursor-pointer active:scale-[0.98] transition-all"
              >
                <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider mb-2 block">
                  {t('transfer.to')}
                </span>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <MintIcon url={toMintUrl} getIconUrl={getIconUrl} />
                    <div className="flex flex-col">
                      <span className="font-bold text-foreground text-sm">
                        {toMint ? toMint.name : t('payment.selectMint')}
                      </span>
                      <span className="text-[10px] text-foreground-muted">{t('transfer.to')}</span>
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-foreground-muted" />
                </div>
              </div>
            </div>
          ) : (
            <div className="animate-fadeIn flex flex-col gap-3">

              {/* From Mint */}
              <div
                onClick={() => setIsMintSelectorOpen('from')}
                className="bg-white/60 p-4 rounded-2xl border border-white/50 shadow-sm relative cursor-pointer active:scale-[0.98] transition-all"
              >
                <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider mb-2 block">
                  {t('transfer.from')}
                </span>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <MintIcon url={fromMintUrl} getIconUrl={getIconUrl} />
                    <div className="flex flex-col">
                      <span className="font-bold text-foreground text-sm">
                        {fromMint ? fromMint.name : t('payment.selectMint')}
                      </span>
                      <span className="text-[10px] text-foreground-muted">
                        {t('common.balance')}: {formatSats(fromMint?.balance || 0)}
                      </span>
                    </div>
                  </div>
                  <ChevronDown className="w-4 h-4 text-foreground-muted" />
                </div>
              </div>

              {/* Lightning Address Input */}
              <div className="bg-white/60 p-4 rounded-2xl border border-white/50 shadow-sm">
                <span className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider mb-2 block">
                  {t('settings.lightningAddress')}
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-accent-warning-bright/20 flex items-center justify-center text-accent-warning-bright shadow-sm">
                    <Zap className="w-4 h-4 fill-current" />
                  </div>
                  <input
                    type="text"
                    placeholder="user@domain.com"
                    value={lnAddress}
                    onChange={(e) => setLnAddress(e.target.value)}
                    className="flex-1 bg-transparent border-none outline-none font-medium text-foreground placeholder:text-foreground-muted/50 h-8 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

        {/* Amount Input (Shared) */}
        <div
          className={cn(
            'p-4 rounded-2xl border flex flex-col items-center justify-center gap-2 py-6 mt-2 transition-all',
            isInsufficientFunds
              ? 'bg-accent-danger/10 border-accent-danger/30'
              : 'bg-primary/5 border-primary/10'
          )}
        >
          <span
            className={cn(
              'text-xs font-bold',
              isInsufficientFunds ? 'text-accent-danger' : 'text-foreground-muted'
            )}
          >
            {isInsufficientFunds ? t('payment.insufficientBalance') : t('common.amount')}
          </span>
          <div className="flex items-baseline justify-center gap-2 w-full">
            {unit === '₿' && (
              <span
                className={cn(
                  'text-lg font-bold',
                  isInsufficientFunds ? 'text-accent-danger' : 'text-foreground-muted'
                )}
              >
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
                setAmount(val)
              }}
              placeholder="0"
              className={cn(
                'bg-transparent text-4xl font-bold text-center outline-none placeholder:text-foreground/20 min-w-[1ch] w-auto',
                isInsufficientFunds ? 'text-accent-danger' : 'text-foreground'
              )}
              style={{ width: amount ? `${amount.length + 1}ch` : '2ch' }}
            />
            {unit !== '₿' && (
              <span
                className={cn(
                  'text-lg font-bold',
                  isInsufficientFunds ? 'text-accent-danger' : 'text-foreground-muted'
                )}
              >
                {unit}
              </span>
            )}
          </div>
          {isInsufficientFunds && (
            <div className="text-[10px] font-bold text-accent-danger mt-2 bg-white/50 px-2 py-1 rounded-full">
              {t('payment.maxAmount', { amount: formatSats(currentBalance) })}
            </div>
          )}
          {!isInsufficientFunds && activeTab === 'melt' && numericAmount > 0 && (
            <div className="flex items-center gap-2 mt-2 px-2 py-1 bg-accent-warning-bright/10 rounded-full text-accent-warning-bright-text text-[10px] font-bold">
              <span>{t('transfer.estimatedFee', { amount: formatSats(2) })}</span>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-accent-danger/10 text-accent-danger p-3 rounded-xl text-xs font-medium text-center">
            {error}
          </div>
        )}
      </div>

      {/* Footer Action */}
      <div className="p-4 pb-safe bg-background/90 backdrop-blur-md absolute bottom-0 left-0 right-0 z-50 border-t border-primary/5">
        <button
          onClick={handleAction}
          disabled={isInsufficientFunds || numericAmount <= 0 || status === 'processing' || isProcessingPayment}
          className={cn(
            'w-full py-3 rounded-[1.5rem] font-bold text-base shadow-xl transition-all flex items-center justify-center gap-2',
            isInsufficientFunds || numericAmount <= 0 || isProcessingPayment
              ? 'bg-primary/50 text-primary-foreground/50 cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:scale-[1.02] active:scale-[0.98] shadow-primary/20'
          )}
        >
          {(status === 'processing' || isProcessingPayment) ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('common.processing')}</span>
            </>
          ) : activeTab === 'swap' ? (
            <>
              <RefreshCw className="w-4 h-4" />
              <span>{t('transfer.swap')}</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 fill-current" />
              <span>{t('payment.pay')}</span>
            </>
          )}
        </button>
      </div>

      {/* Mint Selector Modal */}
        {isMintSelectorOpen && (
          <div
            className="animate-fadeIn absolute inset-0 bg-black/40 backdrop-blur-sm z-[70] flex items-end sm:items-center justify-center"
            onClick={() => setIsMintSelectorOpen(null)}
          >
            <div
              className="animate-slideInUp bg-background w-full max-w-sm m-3 rounded-[1.5rem] overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-primary/10">
                <h3 className="text-base font-bold text-foreground">{t('payment.selectMint')}</h3>
              </div>
              <div className="p-3 flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
                {mintUrls.length === 0 ? (
                  <p className="text-center text-foreground-muted py-8">{t('settings.noMints')}</p>
                ) : (
                  mintUrls.map((url) => {
                    // Normalize URL for balance lookup (remove trailing slash)
                    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url
                    const mintBalance = balance.byMint[normalizedUrl] || balance.byMint[url] || 0
                    const isSelected =
                      (isMintSelectorOpen === 'from' && url === fromMintUrl) ||
                      (isMintSelectorOpen === 'to' && url === toMintUrl)
                    const isDisabled =
                      isMintSelectorOpen === 'to' && url === fromMintUrl

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
                          'p-3 rounded-xl flex items-center justify-between transition-all',
                          isSelected
                            ? 'bg-primary text-white shadow-lg'
                            : 'bg-white/50 text-foreground hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <MintIcon
                            url={url}
                            getIconUrl={getIconUrl}
                            size="sm"
                            className={isSelected ? 'ring-2 ring-white/50' : ''}
                          />
                          <div className="flex flex-col items-start">
                            <span className="font-bold text-sm">
                              {getDisplayName(url)}
                            </span>
                            <span
                              className={cn(
                                'text-[10px]',
                                isSelected ? 'text-white/70' : 'text-foreground-muted'
                              )}
                            >
                              {formatSats(mintBalance)}
                            </span>
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4" />}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  )
}

export default TransferScreen
