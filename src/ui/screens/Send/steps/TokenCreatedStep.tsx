/**
 * TokenCreatedStep — Token created, show QR + share/copy buttons
 * Cancel button reclaims the token
 * Modern layout: bg-background, no border-t
 *
 * Token spending detection via SDK send:finalized event (not custom polling)
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Share2, Copy, X, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hapticTap, hapticSuccess } from '@/utils/haptic'
import { useAppStore } from '@/store'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { Button } from '@/ui/components/common/Button'

interface TokenCreatedStepProps {
  token: string
  amount: number
  operationId?: string
  onCancel: () => void
  onComplete: () => void
}

export function TokenCreatedStep({
  token,
  amount,
  operationId,
  onCancel,
  onComplete,
}: TokenCreatedStepProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const addToast = useAppStore((s) => s.addToast)
  const [isCopied, setIsCopied] = useState(false)
  const [isSpent, setIsSpent] = useState(false)
  const [isCanceling, setIsCanceling] = useState(false)
  const spentGuardRef = useRef(false)

  const handleSpent = useCallback(() => {
    if (spentGuardRef.current) return
    spentGuardRef.current = true
    setIsSpent(true)
    hapticSuccess()
  }, [])

  // Monitor token spending via SDK send:finalized event
  useEffect(() => {
    if (!operationId) return

    let unsubscribe: (() => void) | undefined
    let mounted = true

    const subscribe = async () => {
      try {
        const { getCocoManager } = await import('@/coco/manager')
        const manager = await getCocoManager()
        unsubscribe = manager.on('send:finalized', ({ operationId: finId }) => {
          if (mounted && finId === operationId) {
            handleSpent()
          }
        })
      } catch {
        // Manager not initialized — ignore
      }
    }

    subscribe()

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [operationId, handleSpent])

  // Auto-dismiss after token is claimed
  const onCompleteRef = useRef(onComplete)
  useEffect(() => { onCompleteRef.current = onComplete })
  useEffect(() => {
    if (!isSpent) return
    const timer = setTimeout(() => onCompleteRef.current(), 3000)
    return () => clearTimeout(timer)
  }, [isSpent])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(token)
      setIsCopied(true)
      hapticTap()
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      addToast({ type: 'error', message: t('errors.clipboardError'), duration: 3000 })
    }
  }, [token, addToast, t])

  const handleShare = useCallback(async () => {
    hapticTap()
    try {
      if (navigator.share) {
        await navigator.share({ text: token })
      } else {
        await handleCopy()
      }
    } catch {
      // User cancelled share
    }
  }, [token, handleCopy])

  const handleCancel = useCallback(async () => {
    if (isSpent) {
      addToast({ type: 'info', message: t('send.tokenCreated.alreadySpent'), duration: 3000 })
      return
    }
    setIsCanceling(true)
    hapticTap()
    await onCancel()
    setIsCanceling(false)
  }, [isSpent, onCancel, addToast, t])

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — no border */}
      <header className="flex items-center justify-center px-4 py-3">
        <h1 className="text-subtitle">{isSpent ? t('send.tokenCreated.claimedTitle') : t('send.tokenCreated.title')}</h1>
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-5 gap-6">
        {isSpent ? (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-accent-primary/10 flex items-center justify-center">
              <Check className="w-8 h-8 text-accent-primary" />
            </div>
            <p className="text-subtitle text-center">{t('send.tokenCreated.claimed')}</p>
            <p className="text-foreground-muted text-amount font-display">{formatSats(amount)}</p>
            {(() => { const f = formatFiat(amount); return f ? (
              <p className="text-foreground-muted text-label">{f}</p>
            ) : null })()}
          </div>
        ) : (
          <>
            <p className="text-display font-display">{formatSats(amount)}</p>
            {(() => { const f = formatFiat(amount); return f ? (
              <p className="text-caption text-foreground-muted">{f}</p>
            ) : null })()}

            <QRCodeDisplay
              value={token}
              size={200}
              className="rounded-2xl"
            />

            <div className="flex gap-3 w-full max-w-xs">
              <button
                onClick={handleShare}
                aria-label={t('send.tokenCreated.share')}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-muted font-medium text-caption active:scale-95 transition-transform min-h-[44px]"
              >
                <Share2 className="w-4 h-4" />
                {t('send.tokenCreated.share')}
              </button>
              <button
                onClick={handleCopy}
                aria-label={t('send.tokenCreated.copy')}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-muted font-medium text-caption active:scale-95 transition-transform min-h-[44px]"
              >
                {isCopied ? <Check className="w-4 h-4 text-accent-primary" /> : <Copy className="w-4 h-4" />}
                {isCopied ? t('common.copied') : t('send.tokenCreated.copy')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Bottom — no border-t, no bg */}
      <div className="p-4 pb-safe space-y-2">
        {!isSpent && (
          <button
            onClick={handleCancel}
            disabled={isCanceling}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-accent-danger font-medium text-caption disabled:opacity-50 min-h-[44px]"
          >
            <X className="w-4 h-4" />
            {isCanceling ? t('common.processing') : t('send.tokenCreated.cancel')}
          </button>
        )}
        <Button
          variant="brand"
          size="xl"
          onClick={() => {
            hapticTap()
            onComplete()
          }}
          className="w-full"
        >
          {t('send.tokenCreated.confirm')}
        </Button>
      </div>
    </div>
  )
}
