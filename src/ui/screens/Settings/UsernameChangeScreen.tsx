import { useState, useCallback, useRef } from 'react'
import { ArrowLeft, Zap, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/common'
import { useAppStore } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { NPUBCASH_DOMAIN } from '@/core/constants'
import { isErr } from '@/core/domain/result'
import UsernamePriceSheet from './UsernamePriceSheet'
import type { AliasPriceInfo } from '@/core/ports/driving/payment-alias.usecase'

const USERNAME_REGEX = /^[a-z0-9]{3,20}$/

export interface UsernameChangeScreenProps {
  onBack: () => void
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
}

export function UsernameChangeScreen({ onBack, onSaveSettings }: UsernameChangeScreenProps) {
  const { t } = useTranslation()

  const settings = useAppStore((state) => state.settings)
  const nostrPrivkey = useAppStore((state) => state.nostrPrivkey)
  const addToast = useAppStore((state) => state.addToast)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const triggerTxRefresh = useAppStore((state) => state.triggerTxRefresh)

  const registry = useServiceRegistry()

  const [newUsername, setNewUsername] = useState('')
  const [usernameError, setUsernameError] = useState('')
  const [isChanging, setIsChanging] = useState(false)
  const [isCheckingPrice, setIsCheckingPrice] = useState(false)
  const [price, setPrice] = useState<AliasPriceInfo | null>(null)
  const [showPriceSheet, setShowPriceSheet] = useState(false)
  const prevAddressRef = useRef(settings.lightningAddress || '-')

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

  const handleConfirm = useCallback(async () => {
    if (!isUsernameValid || isCheckingPrice || !nostrPrivkey) return
    setIsCheckingPrice(true)
    try {
      const priceResult = await registry.paymentAlias.checkAliasPrice(nostrPrivkey, newUsername)
      if (isErr(priceResult)) {
        const msg = (priceResult.error as { message?: string }).message ?? t('settings.usernameChangeFailed')
        addToast({ type: 'error', message: msg })
        return
      }

      const priceInfo = priceResult.value
      if (priceInfo.amount === 0) {
        await executeChange()
      } else {
        setPrice(priceInfo)
        setShowPriceSheet(true)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.usernameChangeFailed')
      addToast({ type: 'error', message })
    } finally {
      setIsCheckingPrice(false)
    }
  }, [isUsernameValid, isCheckingPrice, nostrPrivkey, newUsername, registry, addToast, t])

  const executeChange = useCallback(async () => {
    if (!nostrPrivkey) return
    setIsChanging(true)
    try {
      const result = await registry.paymentAlias.changeAlias(nostrPrivkey, newUsername, '')
      if (isErr(result)) {
        const msg = (result.error as { message?: string }).message ?? t('settings.usernameChangeFailed')
        addToast({ type: 'error', message: msg })
        return
      }

      const fullAddress = `${result.value.alias}@${NPUBCASH_DOMAIN}`
      updateSettings({ lightningAddress: fullAddress })
      await onSaveSettings({ ...settings, lightningAddress: fullAddress })
      triggerTxRefresh()

      addToast({ type: 'success', message: t('settings.usernameChanged') })
      onBack()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.usernameChangeFailed')
      addToast({ type: 'error', message })
    } finally {
      setIsChanging(false)
    }
  }, [nostrPrivkey, newUsername, registry, addToast, updateSettings, onSaveSettings, settings, triggerTxRefresh, onBack, t])

  const handlePriceSheetConfirm = useCallback(async () => {
    setShowPriceSheet(false)
    await executeChange()
  }, [executeChange])

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden z-[60]">
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0 z-50">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h2 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">
          {t('settings.changeUsername')}
        </h2>
        <div className="w-10" />
      </header>

      {(isChanging || isCheckingPrice) ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <Loader2 className="w-12 h-12 text-brand animate-spin" />
          <div className="flex flex-col items-center gap-2">
            <p className="text-body font-bold text-foreground">
              {t('settings.changingUsername')}
            </p>
            <div className="flex flex-col items-center gap-1 text-caption text-foreground-muted">
              <span>{prevAddressRef.current}</span>
              <span>↓</span>
              <span className="font-bold text-foreground">{newUsername}@{NPUBCASH_DOMAIN}</span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-6 pt-6 pb-app-action">
            <p className="text-body font-medium text-foreground-muted">{t('settings.currentAddress')}</p>
            <div className="flex items-center gap-2 mt-1.5 mb-8">
              <Zap className="w-5 h-5 text-brand shrink-0" />
              <span className="text-subtitle font-medium text-foreground truncate">
                {settings.lightningAddress || '-'}
              </span>
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
          </div>

          <div className="absolute bottom-0 left-0 right-0 px-6 pb-app bg-gradient-to-t from-background via-background to-transparent pt-4">
            <Button
              variant="brand"
              size="xl"
              onClick={handleConfirm}
              disabled={!isUsernameValid || isCheckingPrice}
              loading={isCheckingPrice}
              className="w-full"
            >
              {t('common.change')}
            </Button>
          </div>
        </>
      )}
      {price && (
        <UsernamePriceSheet
          isOpen={showPriceSheet}
          onClose={() => setShowPriceSheet(false)}
          onConfirm={handlePriceSheetConfirm}
          newUsername={newUsername}
          price={price}
        />
      )}
    </div>
  )
}

export default UsernameChangeScreen
