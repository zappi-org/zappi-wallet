import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Zap, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import { useKeyboardInset } from '@/ui/hooks/use-keyboard-inset'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { useAppStore } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { NPUBCASH_DOMAIN } from '@/core/constants'
import { isErr } from '@/core/domain/result'
import type { AliasPriceInfo } from '@/core/ports/driving/payment-alias.usecase'

const USERNAME_REGEX = /^[a-z0-9]{3,20}$/
/** Availability re-check after the user stops typing. */
const DEBOUNCE_MS = 400
const TITLE_ID = 'change-username-title'

type SheetStep = 'input' | 'checking' | 'price' | 'paying'

/**
 * Inline availability of the typed username. 'idle' is the standing rule hint
 * (and everything before a check lands); 'invalid' is a client-side regex
 * failure; 'taken' is the server saying the name is not for us; 'available'
 * is the server quoting it (price kept so pressing 変更하기 can jump straight
 * to the price step without a second round-trip).
 */
type UsernameStatus =
  | { kind: 'idle' }
  | { kind: 'invalid'; message: string }
  | { kind: 'taken'; message: string }
  | { kind: 'same'; message: string }
  | { kind: 'available'; price: AliasPriceInfo }

export interface ChangeUsernameSheetProps {
  isOpen: boolean
  onClose: () => void
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
}

export function ChangeUsernameSheet({ isOpen, onClose, onSaveSettings }: ChangeUsernameSheetProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  // Lift the sheet above the keyboard (iOS viewport-only resize hides a
  // bottom-anchored sheet, so Safari pans the page). Same as MintSelectBottomSheet.
  const keyboardInset = useKeyboardInset()

  const settings = useAppStore((s) => s.settings)
  const nostrPrivkey = useAppStore((s) => s.nostrPrivkey)
  const addToast = useAppStore((s) => s.addToast)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const triggerTxRefresh = useAppStore((s) => s.triggerTxRefresh)
  const registry = useServiceRegistry()

  // Prefill = the current address (the row is gone; the input IS the address).
  // Mount-time init, not an effect: the parent remounts the sheet per open
  // (keyed by open count), so state starts fresh without the lint-rejected reset effect.
  const currentUsername = (settings.lightningAddress ?? '').split('@')[0]
  const currentAddress = settings.lightningAddress || '-'

  const [step, setStep] = useState<SheetStep>('input')
  // Prefill from the CURRENT address; no select-all/focus on open.
  const [newUsername, setNewUsername] = useState(currentUsername)
  const [status, setStatus] = useState<UsernameStatus>({ kind: 'idle' })
  const [price, setPrice] = useState<AliasPriceInfo | null>(null)

  const debounceTimer = useRef<number | null>(null)
  // Monotonic id: a keystroke while a check is in flight drops the stale response.
  const checkSeq = useRef(0)

  const isUsernameValid = newUsername.length > 0 && USERNAME_REGEX.test(newUsername)

  useEffect(
    () => () => {
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current)
      checkSeq.current += 1
    },
    [],
  )

  const runCheck = useCallback(
    async (value: string, fromPress: boolean) => {
      if (!nostrPrivkey || !USERNAME_REGEX.test(value)) return
      const seq = ++checkSeq.current
      setStatus({ kind: 'idle' })
      if (fromPress) setStep('checking')
      try {
        const result = await registry.paymentAlias.checkAliasPrice(nostrPrivkey, value)
        if (seq !== checkSeq.current) return
        if (isErr(result)) {
          const message = (result.error as { message?: string }).message ?? t('settings.usernameTaken')
          setStatus({ kind: 'taken', message })
          if (fromPress) setStep('input')
          return
        }
        setStatus({ kind: 'available', price: result.value })
        if (fromPress) {
          setPrice(result.value)
          setStep('price')
        }
      } catch (error) {
        if (seq !== checkSeq.current) return
        setStatus({ kind: 'idle' })
        if (fromPress) {
          const message = error instanceof Error ? error.message : t('settings.usernameChangeFailed')
          addToast({ type: 'error', message })
          setStep('input')
        }
      }
    },
    [nostrPrivkey, registry, addToast, t],
  )

  const handleInputChange = useCallback(
    (value: string) => {
      const lower = value.toLowerCase()
      setNewUsername(lower)
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current)
      if (!lower) {
        setStatus({ kind: 'idle' })
        return
      }
      if (!USERNAME_REGEX.test(lower)) {
        setStatus({ kind: 'invalid', message: t('settings.usernameInvalid') })
        return
      }
      // Unchanged name: no server round-trip; a press reports it inline as
      // 'already the current address' instead.
      if (lower === currentUsername) {
        setStatus({ kind: 'idle' })
        return
      }
      setStatus({ kind: 'idle' })
      debounceTimer.current = window.setTimeout(() => {
        void runCheck(lower, false)
      }, DEBOUNCE_MS)
    },
    [runCheck, t, currentUsername],
  )

  const handleCheckPrice = useCallback(() => {
    if (!isUsernameValid || !nostrPrivkey || step === 'checking') return
    // Only the untouched prefill reaches here: report it inline, on press,
    // not while the sheet just sits open.
    if (newUsername === currentUsername) {
      setStatus({ kind: 'same', message: t('settings.usernameSameAddress') })
      return
    }
    // Availability (and its price) already landed from the debounced check —
    // skip the round-trip and go straight to the price step.
    if (status.kind === 'available') {
      setPrice(status.price)
      setStep('price')
      return
    }
    void runCheck(newUsername, true)
  }, [isUsernameValid, nostrPrivkey, step, status, newUsername, currentUsername, runCheck, t])

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

  const statusRow =
    newUsername &&
    (status.kind === 'invalid' ? (
      <div className="flex items-center gap-1.5">
        <XCircle className="w-4 h-4 text-accent-danger" />
        <span className="text-caption text-accent-danger font-medium">{status.message}</span>
      </div>
    ) : status.kind === 'taken' || status.kind === 'same' ? (
      <div className="flex items-center gap-1.5">
        <XCircle className="w-4 h-4 text-accent-danger" />
        <span className="text-caption text-accent-danger font-medium">{status.message}</span>
      </div>
    ) : status.kind === 'available' ? (
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="w-4 h-4 text-accent-success" />
        <span className="text-caption text-accent-success font-medium">{t('settings.usernameAvailable')}</span>
      </div>
    ) : (
      // Standing rule hint — once there is input (the prefill counts), and
      // while a check is in flight.
      <span className="text-caption text-foreground-muted">{t('settings.usernameInvalid')}</span>
    ))

  // Handle + header in children, like MintSelectBottomSheet: the shared
  // handle block is a 44px-tall centered bar (~20px below the bar); the label
  // wants the tight py-2 pair — same structure, same spacing.
  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={TITLE_ID}
      bottomOffset={keyboardInset}
      showHandle={false}
      // Shared sheet animates backdrop + panel on one curve (the old hand-rolled
      // motion sheet's mismatched transitions read as a stray page fade).
      dismissible={step !== 'paying'}
    >
      <div className="flex justify-center py-2">
        <div className="w-10 h-1 bg-foreground-subtle rounded-full" />
      </div>

      <div className="flex items-center justify-center px-4 pb-3">
        <h3 id={TITLE_ID} className="text-[13px] font-semibold text-foreground">
          {t('settings.changeUsername')}
        </h3>
      </div>
      {step === 'input' || step === 'checking' ? (
        <div className="px-7.5 pt-3">
          <p className="text-body font-medium text-foreground-muted">{t('settings.usernameLabel')}</p>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="username"
              className="flex-1 min-w-0 bg-transparent py-2 text-subtitle font-medium text-foreground placeholder:text-foreground-muted focus:outline-none"
              maxLength={20}
              disabled={step === 'checking'}
            />
            <span className="text-body text-foreground-muted shrink-0">@{NPUBCASH_DOMAIN}</span>
          </div>
          <div className="h-px bg-[#8C8C8C]" />

          <div className="h-7 flex items-center mt-2">{statusRow}</div>

          <div className="mt-4 flex gap-3 pb-1">
            <button
              type="button"
              onClick={onClose}
              disabled={step === 'checking'}
              className="h-10 flex-1 rounded-[11px] border border-neutral-300/30 bg-background-card text-[11px] font-medium text-foreground-muted active:scale-[0.98] disabled:opacity-50 transition-transform"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleCheckPrice}
              disabled={!isUsernameValid || step === 'checking'}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-[11px] bg-brand text-[11px] font-bold text-white active:scale-[0.98] disabled:opacity-60 transition-transform"
              style={{
                boxShadow: '0 2px 1px 0 rgba(255,255,255,1), 0 2px 1px 0 rgba(0,0,0,0.1)',
              }}
            >
              {step === 'checking' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5" strokeWidth={2} />
              )}
              <span>{step === 'checking' ? t('common.loading') : t('common.change')}</span>
            </button>
          </div>
        </div>
      ) : step === 'price' || step === 'paying' ? (
        <div className="px-7.5 pt-3">
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

          <div className="mt-6 flex items-center justify-center gap-47.5">
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
                boxShadow: '0 2px 1px 0 rgba(255,255,255,1), 0 2px 1px 0 rgba(0,0,0,0.1)',
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
    </BottomSheet>
  )
}

export default ChangeUsernameSheet
