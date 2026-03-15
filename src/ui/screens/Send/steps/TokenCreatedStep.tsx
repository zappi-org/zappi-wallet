/**
 * TokenCreatedStep — Token created, show QR + share/copy buttons
 * Cancel button reclaims the token
 * Modern layout: bg-[#faf9f6], no border-t
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { Share2, Copy, X, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import { hapticTap, hapticSuccess } from '@/utils/haptic'
import { useAppStore } from '@/store'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { Button } from '@/ui/components/common/Button'
import { checkProofsSpent, subscribeProofSpent } from '@/services/cashu'
import { getDecodedToken } from '@cashu/cashu-ts'

interface TokenCreatedStepProps {
  token: string
  amount: number
  onCancel: () => void
  onComplete: () => void
}

export function TokenCreatedStep({
  token,
  amount,
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

  // Monitor token spending
  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval>
    let unsubscribe: (() => void) | undefined
    let mounted = true

    const handleSpent = () => {
      if (spentGuardRef.current || !mounted) return
      spentGuardRef.current = true
      setIsSpent(true)
      hapticSuccess()
    }

    const startMonitoring = async () => {
      try {
        const decoded = getDecodedToken(token)
        const proofs = decoded.proofs
        const mintUrl = decoded.mint

        let pollCount = 0
        pollTimer = setInterval(async () => {
          if (spentGuardRef.current || !mounted) return
          pollCount++
          if (pollCount > 60) {
            clearInterval(pollTimer)
            return
          }
          try {
            const spentSecrets = await checkProofsSpent(mintUrl, proofs)
            if (spentSecrets.length > 0) {
              clearInterval(pollTimer)
              handleSpent()
            }
          } catch {
            // Ignore polling errors
          }
        }, 3000)

        try {
          const cleanup = await subscribeProofSpent(mintUrl, proofs, () => {
            clearInterval(pollTimer)
            handleSpent()
          })
          if (cleanup) unsubscribe = cleanup
        } catch {
          // WS subscription optional
        }
      } catch {
        // Token decode error
      }
    }

    startMonitoring()

    return () => {
      mounted = false
      clearInterval(pollTimer)
      unsubscribe?.()
    }
  }, [token])

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
    <div className="flex flex-col h-full bg-[#faf9f6]">
      {/* Header — no border */}
      <header className="flex items-center justify-center px-4 py-3">
        <h1 className="text-lg font-semibold">{isSpent ? t('send.tokenCreated.claimedTitle') : t('send.tokenCreated.title')}</h1>
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-5 gap-6">
        {isSpent ? (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-accent-primary/10 flex items-center justify-center">
              <Check className="w-8 h-8 text-accent-primary" />
            </div>
            <p className="text-lg font-semibold text-center">{t('send.tokenCreated.claimed')}</p>
            <p className="text-foreground-muted text-sm">{formatSats(amount)}</p>
            {(() => { const f = formatFiat(amount); return f ? (
              <p className="text-foreground-muted text-xs">≈ {f}</p>
            ) : null })()}
          </div>
        ) : (
          <>
            <p className="text-3xl font-bold">{formatSats(amount)}</p>
            {(() => { const f = formatFiat(amount); return f ? (
              <p className="text-sm text-foreground-muted">≈ {f}</p>
            ) : null })()}

            <div className="bg-white p-4 rounded-2xl shadow-sm">
              <QRCodeSVG
                value={token}
                size={200}
                level="M"
                includeMargin={false}
              />
            </div>

            <div className="flex gap-3 w-full max-w-xs">
              <button
                onClick={handleShare}
                aria-label={t('send.tokenCreated.share')}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#f0f0f0] font-medium text-sm active:scale-95 transition-transform min-h-[44px]"
              >
                <Share2 className="w-4 h-4" />
                {t('send.tokenCreated.share')}
              </button>
              <button
                onClick={handleCopy}
                aria-label={t('send.tokenCreated.copy')}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-[#f0f0f0] font-medium text-sm active:scale-95 transition-transform min-h-[44px]"
              >
                {isCopied ? <Check className="w-4 h-4 text-accent-primary" /> : <Copy className="w-4 h-4" />}
                {isCopied ? t('common.copied') : t('send.tokenCreated.copy')}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Bottom — no border-t, no bg */}
      <div className="p-5 pb-safe space-y-3">
        {!isSpent && (
          <button
            onClick={handleCancel}
            disabled={isCanceling}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-accent-danger font-medium text-sm disabled:opacity-50 min-h-[44px]"
          >
            <X className="w-4 h-4" />
            {isCanceling ? t('common.processing') : t('send.tokenCreated.cancel')}
          </button>
        )}
        <Button
          variant="primary"
          size="xl"
          onClick={() => {
            hapticTap()
            onComplete()
          }}
          className="w-full !bg-[#3b7df5] !text-white !rounded-[14px] !h-14 !text-lg shadow-lg shadow-[#3b7df5]/25"
        >
          {t('send.tokenCreated.confirm')}
        </Button>
      </div>
    </div>
  )
}
