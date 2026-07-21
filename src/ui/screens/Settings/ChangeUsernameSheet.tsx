import { useState, useCallback } from 'react'
import { ArrowRight, Zap, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence, type PanInfo } from 'motion/react'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { useAppStore } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { NPUBCASH_DOMAIN } from '@/core/constants'
import { isErr } from '@/core/domain/result'
import type { AliasPriceInfo } from '@/core/ports/driving/payment-alias.usecase'

const USERNAME_REGEX = /^[a-z0-9]{3,20}$/

type SheetStep = 'input' | 'checking' | 'price' | 'paying'

export interface ChangeUsernameSheetProps {
  isOpen: boolean
  onClose: () => void
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
}

export function ChangeUsernameSheet({ isOpen, onClose, onSaveSettings }: ChangeUsernameSheetProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()

  const settings = useAppStore((s) => s.settings)
  const nostrPrivkey = useAppStore((s) => s.nostrPrivkey)
  const addToast = useAppStore((s) => s.addToast)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const triggerTxRefresh = useAppStore((s) => s.triggerTxRefresh)
  const registry = useServiceRegistry()

  const [step, setStep] = useState<SheetStep>('input')
  const [newUsername, setNewUsername] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [price, setPrice] = useState<AliasPriceInfo | null>(null)

  const isUsernameValid = newUsername.length > 0 && USERNAME_REGEX.test(newUsername)

  const validateUsername = useCallback((value: string) => {
    if (!value) {
      setUsernameError('')
      return
    }
    if (!USERNAME_REGEX.test(value)) {
      setUsernameError(t('settings.usernameInvalid'))
      return
    }
    setUsernameError('')
  }, [t])

  const handleInputChange = useCallback((value: string) => {
    const lower = value.toLowerCase()
    setNewUsername(lower)
    validateUsername(lower)
  }, [validateUsername])

  const handleCheckPrice = useCallback(async () => {
    if (!isUsernameValid || !nostrPrivkey) return
    setStep('checking')
    try {
      const priceResult = await registry.paymentAlias.checkAliasPrice(nostrPrivkey, newUsername)
      if (isErr(priceResult)) {
        const msg = (priceResult.error as { message?: string }).message ?? t('settings.usernameChangeFailed')
        addToast({ type: 'error', message: msg })
        setStep('input')
        return
      }
      setPrice(priceResult.value)
      setStep('price')
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.usernameChangeFailed')
      addToast({ type: 'error', message })
      setStep('input')
    }
  }, [isUsernameValid, nostrPrivkey, newUsername, registry, addToast, t])

  const handleConfirm = useCallback(async () => {
    if (!nostrPrivkey) return
    setStep('paying')
    try {
      const result = await registry.paymentAlias.changeAlias(nostrPrivkey, newUsername, '')
      if (isErr(result)) {
        const msg = (result.error as { message?: string }).message ?? t('settings.usernameChangeFailed')
        addToast({ type: 'error', message: msg })
        setStep('price')
        return
      }

      const fullAddress = `${result.value.alias}@${NPUBCASH_DOMAIN}`
      updateSettings({ lightningAddress: fullAddress })
      await onSaveSettings({ ...settings, lightningAddress: fullAddress })
      triggerTxRefresh()

      addToast({ type: 'success', message: t('settings.usernameChanged') })
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.usernameChangeFailed')
      addToast({ type: 'error', message })
      setStep('price')
    }
  }, [nostrPrivkey, newUsername, registry, addToast, updateSettings, onSaveSettings, settings, triggerTxRefresh, onClose, t])

  const handleBackToInput = useCallback(() => {
    setStep('input')
  }, [])

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (step === 'paying') return
      if (info.offset.y > 100 || info.velocity.y > 500) {
        onClose()
      }
    },
    [step, onClose],
  )

  const currentAddress = settings.lightningAddress || '-'

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-[70]"
            onClick={step === 'paying' ? undefined : onClose}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={handleDragEnd}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed bottom-0 left-0 right-0 rounded-t-3xl z-[80] max-h-[85vh] bg-background-elevated"
          >
            <div className="flex justify-center py-2.5 cursor-grab active:cursor-grabbing touch-none">
              <div className="w-10 h-1 rounded-full bg-foreground/20" />
            </div>

            <div className="px-5 pb-1">
              <h3 className="text-caption font-semibold text-foreground text-center">
                {t('settings.changeUsername')}
              </h3>
            </div>

            <div
              className="px-5"
              style={{ paddingBottom: 'var(--app-bottom-padding)' }}
            >
              {step === 'input' || step === 'checking' ? (
                <div className="pt-3">
                  <div className="flex items-center justify-center gap-3 text-caption mb-5">
                    <div className="flex flex-col items-center">
                      <span className="text-foreground-muted">{t('settings.currentAddress')}</span>
                      <span className="font-medium text-foreground flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5 text-brand" />
                        {currentAddress}
                      </span>
                    </div>
                  </div>

                  <p className="text-body font-medium text-foreground-muted mb-1.5">{t('settings.newUsername')}</p>
                  <div className="flex items-center border-b border-border focus-within:border-foreground/20 transition-colors">
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => handleInputChange(e.target.value)}
                      placeholder="username"
                      className="flex-1 min-w-0 bg-transparent py-2.5 text-subtitle font-medium text-foreground placeholder:text-foreground-muted focus:outline-none"
                      maxLength={20}
                      autoFocus
                      disabled={step === 'checking'}
                    />
                    <span className="text-body text-foreground-muted shrink-0">@{NPUBCASH_DOMAIN}</span>
                  </div>

                  <div className="h-7 flex items-center mt-1.5">
                    {newUsername && (
                      usernameError ? (
                        <div className="flex items-center gap-1.5">
                          <XCircle className="w-4 h-4 text-accent-danger" />
                          <span className="text-body text-accent-danger font-medium">{usernameError}</span>
                        </div>
                      ) : isUsernameValid ? (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4 text-accent-success" />
                          <span className="text-body text-accent-success font-medium">{t('settings.usernameAvailable')}</span>
                        </div>
                      ) : null
                    )}
                  </div>

                  <div className="mt-6 flex items-center justify-center gap-[190px]">
                    <button
                      type="button"
                      onClick={onClose}
                      disabled={step === 'checking'}
                      className="px-3 py-2.5 text-caption font-medium text-accent-danger disabled:opacity-50"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleCheckPrice}
                      disabled={!isUsernameValid || step === 'checking'}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-[25px] bg-brand text-caption font-bold text-white active:scale-[0.98] disabled:opacity-60 transition-transform"
                      style={{
                        boxShadow:
                          '0 2px 1px 0 rgba(255,255,255,1), 0 2px 1px 0 rgba(0,0,0,0.1)',
                      }}
                    >
                      {step === 'checking' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Zap className="w-4 h-4" strokeWidth={2} />
                      )}
                      <span>{step === 'checking' ? t('common.loading') : t('common.change')}</span>
                    </button>
                  </div>
                </div>
              ) : step === 'price' || step === 'paying' ? (
                <div className="pt-3">
                  <div className="flex items-center justify-center gap-3 text-caption">
                    <div className="flex flex-col items-center">
                      <span className="text-foreground-muted">{t('settings.currentAddress')}</span>
                      <span className="font-medium text-foreground">{currentAddress}</span>
                    </div>
                    <ArrowRight className="w-4 h-4 text-foreground-muted" />
                    <div className="flex flex-col items-center">
                      <span className="text-foreground-muted">{t('settings.newUsername')}</span>
                      <span className="flex items-center gap-1 font-bold text-foreground">
                        <Zap className="w-4 h-4 text-brand" />
                        {newUsername}@{NPUBCASH_DOMAIN}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl bg-background px-4 py-5 mt-4">
                    <div className="text-center">
                      <span className="text-title-lg font-bold text-foreground">
                        {price ? formatSats(price.amount) : formatSats(0)}
                      </span>
                      {price && price.amount > 0 && (
                        <span className="block text-caption text-foreground-muted mt-1">
                          {formatFiat(price.amount)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 flex items-center justify-center gap-[190px]">
                    <button
                      type="button"
                      onClick={handleBackToInput}
                      disabled={step === 'paying'}
                      className="px-3 py-2.5 text-caption font-medium text-accent-danger disabled:opacity-50"
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={step === 'paying'}
                      className="flex items-center gap-2 px-6 py-2.5 rounded-[25px] bg-brand text-caption font-bold text-white active:scale-[0.98] disabled:opacity-60 transition-transform"
                      style={{
                        boxShadow:
                          '0 2px 1px 0 rgba(255,255,255,1), 0 2px 1px 0 rgba(0,0,0,0.1)',
                      }}
                    >
                      {step === 'paying' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Zap className="w-4 h-4" strokeWidth={2} />
                      )}
                      <span>{step === 'paying' ? t('common.loading') : t('common.confirm')}</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export default ChangeUsernameSheet
