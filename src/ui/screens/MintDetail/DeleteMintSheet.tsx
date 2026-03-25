import { useState, useMemo, useCallback } from 'react'
import { X, ArrowDown, ChevronDown, Loader2, AlertCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/components/common/Button'
import { useFormatSats } from '@/utils/format'
import { useAppStore } from '@/store'
import { useMintMetadata, usePayment } from '@/hooks'
import type { MintInfo } from '@/core/types'

type DeleteStep = 'confirm-empty' | 'has-balance' | 'swapping' | 'error'

interface DeleteMintSheetProps {
  isOpen: boolean
  mint: MintInfo
  onClose: () => void
  onDelete: (url: string) => void
}

export function DeleteMintSheet({ isOpen, mint, onClose, onDelete }: DeleteMintSheetProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName } = useMintMetadata(settings.mints)
  const { mintSwap } = usePayment()

  const hasBalance = mint.balance > 0
  const [step, setStep] = useState<DeleteStep>(hasBalance ? 'has-balance' : 'confirm-empty')
  const [targetMintUrl, setTargetMintUrl] = useState<string | null>(null)
  const [showMintPicker, setShowMintPicker] = useState(false)
  const [swapError, setSwapError] = useState<string | null>(null)

  // Other mints (for swap destination)
  const otherMints = useMemo(() => {
    const normalized = mint.url.endsWith('/') ? mint.url.slice(0, -1) : mint.url
    return settings.mints.filter((url) => {
      const n = url.endsWith('/') ? url.slice(0, -1) : url
      return n !== normalized
    })
  }, [settings.mints, mint.url])

  const effectiveTargetUrl = targetMintUrl || otherMints[0] || null

  const handleDelete = useCallback(async () => {
    if (hasBalance) {
      if (!effectiveTargetUrl) {
        // No target mint available — cannot swap, just delete
        onDelete(mint.url)
        return
      }

      // Execute swap first, then delete
      setStep('swapping')
      setSwapError(null)

      try {
        const result = await mintSwap(mint.url, effectiveTargetUrl, mint.balance, { drain: true })
        if (result) {
          onDelete(mint.url)
        } else {
          // mintSwap returns null on failure (toast already shown by hook)
          setStep('error')
          setSwapError(t('mintDetail.swapFailed'))
        }
      } catch {
        setStep('error')
        setSwapError(t('mintDetail.swapFailed'))
      }
    } else {
      onDelete(mint.url)
    }
  }, [hasBalance, mint.url, mint.balance, effectiveTargetUrl, mintSwap, onDelete, t])

  const mintName = getDisplayName(mint.url)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center pointer-events-none">
      <div
        onClick={step === 'swapping' ? undefined : onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto animate-fadeIn"
      />
      <div className="bg-background w-full rounded-t-2xl pointer-events-auto relative z-10 shadow-2xl pb-safe animate-slideInUp border border-border/30">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4">
          <div className="w-9" />
          <h3 className="text-subtitle text-accent-danger">
            {t('mintDetail.deleteMint')}
          </h3>
          <button
            onClick={onClose}
            disabled={step === 'swapping'}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-muted disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pb-6">
          {step === 'confirm-empty' && (
            <div className="space-y-6">
              <p className="text-center text-subtitle font-medium text-foreground">
                {t('mintDetail.deleteConfirmMessage')}
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" size="lg" onClick={onClose} className="flex-1">
                  {t('mintDetail.no')}
                </Button>
                <Button variant="destructive" size="lg" onClick={handleDelete} className="flex-1">
                  {t('mintDetail.delete')}
                </Button>
              </div>
            </div>
          )}

          {step === 'has-balance' && (
            <div className="space-y-5">
              <p className="text-subtitle font-medium text-foreground whitespace-pre-line">
                {t('mintDetail.balanceRemaining', {
                  mint: mintName,
                  amount: formatSats(mint.balance),
                })}
              </p>

              {/* Source mint */}
              <div>
                <p className="text-body font-semibold text-foreground mb-2">
                  {t('mintDetail.emptyMint')}
                </p>
                <div className="bg-muted rounded-xl px-4 py-3">
                  <span className="text-body text-foreground">{mintName}</span>
                </div>
              </div>

              {/* Arrow */}
              <div className="flex justify-center">
                <ArrowDown className="w-5 h-5 text-foreground" />
              </div>

              {/* Target mint */}
              <div>
                <p className="text-body font-semibold text-foreground mb-2">
                  {t('mintDetail.fillMint')}
                </p>
                {otherMints.length > 0 ? (
                  <div className="relative">
                    <button
                      onClick={() => setShowMintPicker(!showMintPicker)}
                      className="w-full bg-muted rounded-xl px-4 py-3 flex items-center justify-between"
                    >
                      <span className="text-body text-foreground">
                        {effectiveTargetUrl ? getDisplayName(effectiveTargetUrl) : ''}
                      </span>
                      <ChevronDown className={cn('w-4 h-4 text-foreground-muted transition-transform', showMintPicker && 'rotate-180')} />
                    </button>
                    {showMintPicker && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-background-card rounded-xl shadow-lg border border-border z-10 overflow-hidden">
                        {otherMints.map((url) => (
                          <button
                            key={url}
                            onClick={() => { setTargetMintUrl(url); setShowMintPicker(false) }}
                            className="w-full px-4 py-3 text-left text-caption hover:bg-background-hover transition-colors"
                          >
                            {getDisplayName(url)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-muted rounded-xl px-4 py-3">
                    <span className="text-caption text-foreground-muted">{t('mintDetail.sendElsewhere')}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="space-y-3 pt-2">
                <Button
                  variant="destructive"
                  size="xl"
                  onClick={handleDelete}
                  className="w-full"
                >
                  {t('mintDetail.emptyAndDeleteBtn')}
                </Button>
              </div>
            </div>
          )}

          {step === 'swapping' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="w-12 h-12 text-brand animate-spin" />
              <p className="text-subtitle font-medium text-foreground text-center">
                {t('mintDetail.swapping')}
              </p>
            </div>
          )}

          {step === 'error' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <AlertCircle className="w-12 h-12 text-accent-danger" />
              <p className="text-body font-medium text-foreground text-center">
                {swapError}
              </p>
              <div className="flex gap-3 w-full">
                <button
                  onClick={onClose}
                  className="flex-1 py-4 rounded-xl bg-muted font-semibold text-caption text-foreground"
                >
                  {t('common.close')}
                </button>
                <button
                  onClick={() => setStep('has-balance')}
                  className="flex-1 py-4 rounded-xl bg-brand font-semibold text-caption text-white"
                >
                  {t('mintDetail.retry')}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
