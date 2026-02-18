/**
 * Token Receive Screen (Unified)
 * Single screen for receiving Cashu tokens: shows token info + receive button
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { ArrowLeft, Banknote, CheckCircle2, Loader2, AlertCircle, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hapticTap, hapticSuccess, hapticError } from '@/utils/haptic'
import type { ValidatedCashuToken } from '@/ui/components/scanner'

export interface TokenReceiveScreenProps {
  onBack: () => void
  onComplete?: () => void
  onReceiveToken: (token: string) => Promise<{ success: boolean; amount?: number }>
  onAddTrustedMint?: (mintUrl: string) => Promise<boolean>
  validatedData: ValidatedCashuToken
  trustedMints?: string[]
}

export function TokenReceiveScreen({
  onBack,
  onComplete,
  onReceiveToken,
  onAddTrustedMint,
  validatedData,
  trustedMints = [],
}: TokenReceiveScreenProps) {
  const { t } = useTranslation()
  // State
  const [isReceiving, setIsReceiving] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [receivedAmount, setReceivedAmount] = useState(0)
  const [error, setError] = useState<string>('')

  // Check if mint is trusted
  const isMintTrusted = useMemo(() => {
    return trustedMints.includes(validatedData.mintUrl)
  }, [trustedMints, validatedData.mintUrl])

  // Extract mint display name
  const mintDisplayName = useMemo(() => {
    try {
      const url = new URL(validatedData.mintUrl)
      return url.hostname
    } catch {
      return validatedData.mintUrl
    }
  }, [validatedData.mintUrl])

  // Handle receive — if mint is untrusted, add it first then receive
  const handleReceive = useCallback(async () => {
    setIsReceiving(true)
    setError('')
    hapticTap()

    try {
      // If mint is not trusted, add it first
      if (!trustedMints.includes(validatedData.mintUrl)) {
        if (!onAddTrustedMint) {
          throw new Error(t('payment.untrustedMintWarning'))
        }
        const trustSuccess = await onAddTrustedMint(validatedData.mintUrl)
        if (!trustSuccess) {
          throw new Error(t('payment.mintAddFailed'))
        }
      }

      // Now receive the token
      const result = await onReceiveToken(validatedData.token)
      if (result.success) {
        hapticSuccess()
        setReceivedAmount(result.amount || validatedData.amountSats)
        setIsSuccess(true)
      } else {
        throw new Error(t('payment.tokenReceiveFailed'))
      }
    } catch (err) {
      hapticError()
      const message = err instanceof Error ? err.message : t('payment.tokenReceiveFailed')
      setError(message)
    } finally {
      setIsReceiving(false)
    }
  }, [validatedData.token, validatedData.mintUrl, validatedData.amountSats, onReceiveToken, onAddTrustedMint, trustedMints, t])

  // Navigate to home after completion (fallback to onBack if onComplete not provided)
  const handleComplete = onComplete ?? onBack
  const handleCompleteRef = useRef(handleComplete)
  handleCompleteRef.current = handleComplete

  // Auto-dismiss success screen after 4 seconds
  useEffect(() => {
    if (!isSuccess) return
    const timer = setTimeout(() => handleCompleteRef.current(), 4000)
    return () => clearTimeout(timer)
  }, [isSuccess])

  return (
    <div className="h-dvh bg-background text-foreground font-sans flex flex-col pt-safe">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border-visible">
        <button
          onClick={onBack}
          disabled={isReceiving}
          aria-label={t('common.back')}
          className="p-2 -ml-2 rounded-lg hover:bg-border-visible transition-colors disabled:opacity-50"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Banknote className="w-5 h-5" />
          {t('payment.tokenReceive')}
        </h1>
        <div className="w-9" />
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        {isSuccess ? (
            // Success state
            <div
              className="flex flex-col items-center gap-4 animate-scaleIn"
            >
              <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
                <CheckCircle2 className="w-12 h-12 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold">₿{receivedAmount.toLocaleString()}</p>
                <p className="text-foreground-muted mt-2">{t('payment.successReceived')}</p>
              </div>
              <button
                onClick={handleComplete}
                className="mt-4 px-8 py-3 bg-accent-primary text-white rounded-xl font-semibold"
              >
                {t('payment.done')}
              </button>
            </div>
          ) : (
            // Token info
            <div
              className="w-full max-w-sm flex flex-col gap-4 animate-fadeIn"
            >
              {/* Amount */}
              <p className="text-4xl font-bold text-center">₿{validatedData.amountSats.toLocaleString()}</p>

              {/* Token details */}
              <div className="bg-background-card rounded-2xl p-4 space-y-3 border border-border">
                {/* Mint */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground-muted">{t('payment.tokenMint')}</span>
                  <span className="font-medium truncate max-w-[200px]">{mintDisplayName}</span>
                </div>

                {/* Memo if exists */}
                {validatedData.memo && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-foreground-muted">{t('common.memo')}</span>
                    <span className="font-medium">{validatedData.memo}</span>
                  </div>
                )}

                {/* Trust status */}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-foreground-muted">{t('payment.trustStatus')}</span>
                  {isMintTrusted ? (
                    <span className="text-accent-primary font-medium flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      {t('payment.trusted')}
                    </span>
                  ) : (
                    <span className="text-accent-warning font-medium flex items-center gap-1">
                      <AlertCircle className="w-4 h-4" />
                      {t('payment.untrusted')}
                    </span>
                  )}
                </div>
              </div>

              {/* Warning for untrusted mint */}
              {!isMintTrusted && (
                <div className="bg-accent-warning/10 border border-accent-warning/20 rounded-xl p-4">
                  <p className="text-sm text-accent-warning">
                    {t('payment.untrustedMintWarning')}
                  </p>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div
                  className="flex items-center gap-2 px-4 py-3 bg-accent-danger/10 border border-accent-danger/20 rounded-xl text-accent-danger animate-fadeIn"
                >
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span className="text-sm">{error}</span>
                </div>
              )}
            </div>
          )}
      </div>

      {/* Bottom Action */}
      {!isSuccess && (
        <div className="p-4 pb-safe border-t border-border-visible bg-background-card">
          <button
            onClick={handleReceive}
            disabled={isReceiving}
            className="w-full py-4 rounded-2xl bg-accent-primary text-white font-semibold text-lg shadow-[0_4px_16px_rgba(91,122,84,0.35)] disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isReceiving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {t('payment.receiving')}
              </>
            ) : !isMintTrusted ? (
              <>
                <Plus className="w-5 h-5" />
                {t('payment.trustAndReceive')}
              </>
            ) : (
              <>
                <Banknote className="w-5 h-5" />
                {t('payment.receiveAmountBtn', { amount: validatedData.amountSats.toLocaleString(), unit: '₿' })}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

export default TokenReceiveScreen
