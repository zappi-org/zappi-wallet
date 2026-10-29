import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { Zap, CheckCircle2, XCircle, Loader2, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '@/ui/components/common/BottomSheet'
import { TEST_IDS, stateAttrs } from '@/ui/lib/test-ids'
import { useKeyboardInset } from '@/ui/hooks/use-keyboard-inset'
import { useFormatSats } from '@/utils/format'
import { useAppStore } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'
import { NPUBCASH_DOMAIN } from '@/core/constants'
import { writeMyAddressCache } from '@/ui/utils/my-address-cache'
import { getErrorI18n, translateError } from '@/ui/utils/error-i18n'
import { isErr } from '@/core/domain/result'
import { sat } from '@/core/domain/amount'
import { FundingRequiredError } from '@/core/errors'
import { getMintBalance } from '@/utils/url'
import type { AliasPriceInfo } from '@/core/ports/driving/payment-alias.usecase'

const USERNAME_REGEX = /^[a-z0-9]{3,20}$/
/** Availability re-check after the user stops typing. */
const DEBOUNCE_MS = 400
/** Paid → success card (spec: success arrives 1-2s after payment completes). */
const SUCCESS_DELAY_MS = 1500
/** Ghost-load the address/fee fields this long on confirm-card entry (spec). */
const GHOST_MS = 1000
const TITLE_ID = 'change-username-title'

/** Max-balance mint, excluding the payment mint. */
function bestFundedMint(
  mintUrls: string[],
  byMint: Record<string, number>,
  exclude?: string,
): string | null {
  let best: string | null = null
  let bestBalance = -1
  for (const url of mintUrls) {
    if (url === exclude) continue
    const value = getMintBalance(url, byMint)
    if (value > bestBalance) {
      bestBalance = value
      best = url
    }
  }
  return best
}

/**
 * True when some mint (≠ exclude) holds at least the fee. The swap moves the
 * FULL required amount, so the target's own balance doesn't help — only the
 * source's does. Best-balance ≥ fee ⟺ some mint can cover it.
 *
 * `mintUrls` is fed the wallet's actual mint keys (`balance.byMint`), not
 * `settings.mints`: a deposit can land on a mint the user never listed.
 */
function hasPayableSource(
  mintUrls: string[],
  byMint: Record<string, number>,
  requiredAmount: number,
  exclude?: string,
): boolean {
  const best = bestFundedMint(mintUrls, byMint, exclude)
  return best !== null && getMintBalance(best, byMint) >= requiredAmount
}

type SheetStep = 'input' | 'checking' | 'confirm' | 'paying' | 'success'

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
  | { kind: 'available'; username: string; price: AliasPriceInfo }

export interface ChangeUsernameSheetProps {
  isOpen: boolean
  onClose: () => void
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
  onAddressChanged?: (address: string) => void
}

export function ChangeUsernameSheet({ isOpen, onClose, onSaveSettings, onAddressChanged }: ChangeUsernameSheetProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const reduceMotion = useReducedMotion()
  // Lift the sheet above the keyboard (iOS viewport-only resize hides a
  // bottom-anchored sheet, so Safari pans the page). Same as MintSelectBottomSheet.
  const keyboardInset = useKeyboardInset()

  const settings = useAppStore((s) => s.settings)
  const nostrPrivkey = useAppStore((s) => s.nostrPrivkey)
  const nostrPubkey = useAppStore((s) => s.nostrPubkey)
  const balance = useAppStore((s) => s.balance)
  const addToast = useAppStore((s) => s.addToast)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const triggerTxRefresh = useAppStore((s) => s.triggerTxRefresh)
  const registry = useServiceRegistry()

  // Mount-time init, not an effect: the parent remounts the sheet per open.
  // Prefill real aliases only — an npub address (the server default when no name
  // is bought) exceeds maxLength and could only be deleted char by char.
  const addressLocalPart = (settings.lightningAddress ?? '').split('@')[0]
  const currentUsername = USERNAME_REGEX.test(addressLocalPart) ? addressLocalPart : ''
  const unaliasedAddress = currentUsername ? '' : (settings.lightningAddress ?? '')

  const [step, setStep] = useState<SheetStep>('input')
  // Prefill from the CURRENT address; no select-all/focus on open.
  const [newUsername, setNewUsername] = useState(currentUsername)
  const [status, setStatus] = useState<UsernameStatus>({ kind: 'idle' })
  const [price, setPrice] = useState<AliasPriceInfo | null>(null)
  // Payment OK — show a done mark in the pay button for the beat before success.
  const [settled, setSettled] = useState(false)

  // Payment mint short on balance: mint sheet swap-in, best source pre-selected.
  const [funding, setFunding] = useState<{ targetMintUrl: string; requiredAmount: number } | null>(null)
  const [fundingSheetOpen, setFundingSheetOpen] = useState(false)

  // No mint can cover the fee → show X + message inline (replaces the
  // irreversible-fee hint) instead of a toast, and block the pay button.
  const [payBlocked, setPayBlocked] = useState(false)

  // Same predicate as handleConfirm's pre-check, evaluated at render so the
  // confirm card blocks before the user taps pay. Self-clears on new price/balance.
  const blockedBeforePay = useMemo(() => {
    // Non-sat quotes can't be compared against a sat balance.
    if (price?.unit !== 'sat' || !price.mintUrl) return false
    const urls = Object.keys(balance.byMint)
    const required = price.amount
    return (
      urls.length > 0 &&
      getMintBalance(price.mintUrl, balance.byMint) < required &&
      !hasPayableSource(urls, balance.byMint, required, price.mintUrl)
    )
  }, [balance, price])

  // Ghost-load the address/fee fields on confirm-card entry, then reveal.
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    if (step !== 'confirm') return
    const timer = window.setTimeout(() => setRevealed(true), GHOST_MS)
    return () => window.clearTimeout(timer)
  }, [step])

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
        setStatus({ kind: 'available', username: value, price: result.value })
        if (fromPress) {
          setPrice(result.value)
          setRevealed(false)
          setStep('confirm')
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
      checkSeq.current += 1
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
    // A queued debounce must not supersede this explicit check while the
    // input is disabled, leaving the sheet stuck on "checking".
    if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current)
    setPayBlocked(false)
    // Only the untouched prefill reaches here: report it inline, on press,
    // not while the sheet just sits open.
    if (newUsername === currentUsername) {
      setStatus({ kind: 'same', message: t('settings.usernameSameAddress') })
      return
    }
    // Availability (and its price) already landed from the debounced check —
    // skip the round-trip and go straight to the price step.
    if (status.kind === 'available' && status.username === newUsername) {
      setPrice(status.price)
      setRevealed(false)
      setStep('confirm')
      return
    }
    void runCheck(newUsername, true)
  }, [isUsernameValid, nostrPrivkey, step, status, newUsername, currentUsername, runCheck, t])

  const openFundingSheet = useCallback((targetMintUrl: string, requiredAmount: number) => {
    setFunding({ targetMintUrl, requiredAmount })
    setFundingSheetOpen(true)
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!nostrPrivkey) return

    // Judge on the freshest balance, never the render snapshot: the store can
    // have been emptied (or refilled) since the last paint.
    const fresh = useAppStore.getState().balance
    const urls = Object.keys(fresh.byMint)
    const required = price?.amount ?? 0
    const paymentMint = price?.mintUrl ?? ''
    // Pre-check skips the failing round-trip when the payment mint is short.
    if (
      price?.unit === 'sat' &&
      paymentMint &&
      urls.length > 0 &&
      getMintBalance(paymentMint, fresh.byMint) < required
    ) {
      if (!hasPayableSource(urls, fresh.byMint, required, paymentMint)) {
        setPayBlocked(true)
        return
      }
      openFundingSheet(paymentMint, required)
      return
    }

    setStep('paying')
    setSettled(false)
    try {
      const result = await registry.paymentAlias.changeAlias(nostrPrivkey, newUsername, '', t('settings.changeUsername'))
      if (isErr(result)) {
        if (result.error instanceof FundingRequiredError) {
          const { targetMintUrl, requiredAmount } = result.error
          const latest = useAppStore.getState().balance
          const latestUrls = Object.keys(latest.byMint)
          const targetBalance = getMintBalance(targetMintUrl, latest.byMint)
          // The target may already hold the fee and be short only of the send fee,
          // so the amount to move is the deficit, not the whole fee again.
          const deficit = Math.max(requiredAmount - targetBalance, 1)
          // creq mint can differ from the quoted mint; the source check must use
          // the same deficit the sheet will swap.
          if (!hasPayableSource(latestUrls, latest.byMint, deficit, targetMintUrl)) {
            setPayBlocked(true)
          } else {
            openFundingSheet(targetMintUrl, deficit)
          }
          setRevealed(false)
          setStep('confirm')
          return
        }
        const msg = (result.error as { message?: string }).message ?? t('settings.usernameChangeFailed')
        addToast({ type: 'error', message: msg })
        setRevealed(false)
        setStep('confirm')
        return
      }

      const fullAddress = `${result.value.alias}@${NPUBCASH_DOMAIN}`
      updateSettings({ lightningAddress: fullAddress })
      onAddressChanged?.(fullAddress)
      // Display cache first (MyAddressScreen shows cache over settings), so a
      // just-changed alias must land here or the QR would snap back to the
      // old address until the next revalidation.
      if (nostrPubkey) writeMyAddressCache(nostrPubkey, { address: fullAddress, updatedAt: Date.now() })
      await onSaveSettings({ ...settings, lightningAddress: fullAddress })
      triggerTxRefresh()
      // 첫 등록(기존 주소 없음)일 때에만 주거래 민트(mints[0])를 서버에 등록.
      // 개명/변경엔 기존 민트 유지. 실패해도 등록은 계속됨.
      if (!currentUsername) {
        const mainMint = settings.mints[0]
        if (mainMint) void registry.paymentAlias.setMint(nostrPrivkey, mainMint).catch(() => {})
      }

      // Paid: the confirm view holds with a done mark for a beat (spec), then
      // the success card replaces it. No success toast — the card says it.
      setSettled(true)
      window.setTimeout(() => setStep('success'), SUCCESS_DELAY_MS)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.usernameChangeFailed')
      addToast({ type: 'error', message })
      setRevealed(false)
      setStep('confirm')
    }
  }, [nostrPrivkey, nostrPubkey, price, newUsername, registry, addToast, updateSettings, onSaveSettings, onAddressChanged, settings, triggerTxRefresh, t, openFundingSheet, currentUsername])

  // Swap-in confirmed: fund payment mint, then retry changeAlias.
  const handleFundingSwap = useCallback(async (sourceMint: string) => {
    if (!nostrPrivkey || !funding) return
    setFundingSheetOpen(false)
    setStep('paying')
    setSettled(false)
    try {
      const swapResult = await registry.swap.executeSwap({
        sourceAccountId: sourceMint,
        targetAccountId: funding.targetMintUrl,
        amount: sat(funding.requiredAmount),
      })
      if (isErr(swapResult)) {
        // No specific translation for this failure (UNKNOWN carries the mint's own reason;
        // translateError would flatten it to "unknown error"). isRetryable = still landing,
        // so say "delayed", not "failed" — and read the flag for any future code, not just UNKNOWN.
        const swapError = swapResult.error
        addToast({
          type: 'error',
          message: getErrorI18n(swapError).key === 'errors.unknownError'
            ? t(swapError.isRetryable ? 'errors.swapDelayedWithReason' : 'errors.swapFailedWithReason', { reason: swapError.message })
            : translateError(swapError, t),
        })
        setStep('confirm')
        return
      }
      //try change alias
      const result = await registry.paymentAlias.changeAlias(nostrPrivkey, newUsername, '', t('settings.changeUsername'))
      if (isErr(result)) {
        addToast({ type: 'error', message: (result.error as { message?: string }).message ?? t('settings.usernameChangeFailed') })
        setStep('confirm')
        return
      }

      const fullAddress = `${result.value.alias}@${NPUBCASH_DOMAIN}`
      updateSettings({ lightningAddress: fullAddress })
      onAddressChanged?.(fullAddress)
      if (nostrPubkey) {
        writeMyAddressCache(nostrPubkey, {
          address: `${result.value.alias}@${NPUBCASH_DOMAIN}`,
          updatedAt: Date.now(),
        })
      }
      await onSaveSettings({ ...settings, lightningAddress: `${result.value.alias}@${NPUBCASH_DOMAIN}` })
      triggerTxRefresh()
      if (!currentUsername) {
        const mainMint = settings.mints[0]
        if (mainMint) void registry.paymentAlias.setMint(nostrPrivkey, mainMint).catch(() => {})
      }
      setSettled(true)
      window.setTimeout(() => setStep('success'), SUCCESS_DELAY_MS)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('settings.usernameChangeFailed')
      addToast({ type: 'error', message })
      setStep('confirm')
    }
  }, [nostrPrivkey, nostrPubkey, funding, newUsername, registry, addToast, updateSettings, onSaveSettings, onAddressChanged, settings, triggerTxRefresh, t, currentUsername])

  // Best source pre-select; user still confirms.
  const bestSourceMint = useMemo(
    () => (funding ? bestFundedMint(Object.keys(balance.byMint), balance.byMint, funding.targetMintUrl) : null),
    [funding, balance.byMint],
  )

  const handleBackToInput = useCallback(() => {
    setStep('input')
    setPayBlocked(false)
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

  // npub address: shown, not pre-filled.
  const idleRow = unaliasedAddress ? (
    <span className="text-caption text-foreground-muted truncate" title={unaliasedAddress}>
      {unaliasedAddress}
    </span>
  ) : null

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

      {step !== 'success' && (
        <div className="flex items-center justify-center px-4 pb-3">
          <h3 id={TITLE_ID} className="text-[13px] font-semibold text-foreground">
            {t(step === 'confirm' || step === 'paying' ? 'settings.changeConfirmTitle' : 'settings.changeUsername')}
          </h3>
        </div>
      )}
      {step === 'input' || step === 'checking' ? (
        <div className="px-7.5 pt-3">
          <p className="text-body font-medium text-foreground-muted">{t('settings.usernameLabel')}</p>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="text"
              data-testid={TEST_IDS.changeUsername.input}
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

          <div className="h-7 flex items-center mt-2">{statusRow || idleRow}</div>

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
              data-testid={TEST_IDS.changeUsername.submit}
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
      ) : step === 'confirm' || step === 'paying' ? (
        <div className="px-7.5 pt-3">
          <p className="text-label font-medium text-foreground-muted">{t('settings.newAddressLabel')}</p>
          <p className="mt-1 text-body font-medium text-foreground">
            {revealed ? (
              <>
                {newUsername}
                <span className="text-foreground-muted">@{NPUBCASH_DOMAIN}</span>
              </>
            ) : (
              <span
                role="status"
                aria-label={t('common.loading')}
                className={`inline-block h-4 w-36 rounded-md bg-foreground-muted/15 ${reduceMotion ? '' : 'animate-pulse'}`}
              />
            )}
          </p>

          <div className="mt-5">
            <p className="text-label font-medium text-foreground-muted">{t('settings.changeFee')}</p>
            <p className="mt-1 text-[13px] leading-4 font-bold text-foreground">
              {revealed ? (
                price ? formatSats(price.amount) : formatSats(0)
              ) : (
                <span
                  role="status"
                  aria-label={t('common.loading')}
                  className={`inline-block h-4 w-16 rounded-md bg-foreground-muted/15 ${reduceMotion ? '' : 'animate-pulse'}`}
                />
              )}
            </p>
          </div>

          <div className="mt-5 flex items-center gap-2">
            {/* Failure line only while the user can still act on it: mid-payment the
                balance dips below the fee as proofs lock, which is not a failure. */}
            {step === 'confirm' && (blockedBeforePay || payBlocked) ? (
              <>
                <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-accent-danger" strokeWidth={1.5} aria-hidden />
                <p
                  {...stateAttrs(TEST_IDS.changeUsername.notice, 'blocked')}
                  className="text-label leading-4 text-accent-danger"
                >{t('settings.noPayableMint')}</p>
              </>
            ) : (
              <>
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-foreground-muted" strokeWidth={1.5} aria-hidden />
                <p
                  {...stateAttrs(TEST_IDS.changeUsername.notice, 'info')}
                  className="text-label leading-4 text-foreground-muted"
                >{t('settings.changeIrreversible')}</p>
              </>
            )}
          </div>

          {/* Same shape as the input step's pair: 취소 back to input, 결제 runs the paid change. */}
          <div className="mt-6 flex gap-3 pb-1">
            <button
              type="button"
              onClick={handleBackToInput}
              disabled={step === 'paying'}
              className="h-10 flex-1 rounded-[11px] border border-neutral-300/30 bg-background-card text-[11px] font-medium text-foreground-muted active:scale-[0.98] disabled:opacity-50 transition-transform"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              data-testid={TEST_IDS.changeUsername.pay}
              onClick={handleConfirm}
              disabled={step === 'paying' || blockedBeforePay}
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-[11px] bg-brand text-[11px] font-bold text-white active:scale-[0.98] disabled:opacity-60 transition-transform"
              style={{
                boxShadow: '0 2px 1px 0 rgba(255,255,255,1), 0 2px 1px 0 rgba(0,0,0,0.1)',
              }}
            >
              {step === 'paying' ? (
                settled ? (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                ) : (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )
              ) : (
                <Zap className="w-3.5 h-3.5" strokeWidth={2} />
              )}
              <span>{step === 'paying' ? t('common.loading') : t('settings.pay')}</span>
            </button>
          </div>
        </div>
      ) : step === 'success' ? (
        <div
          data-testid={TEST_IDS.changeUsername.success}
          className="flex flex-col items-center px-7.5 pt-3 pb-1 text-center"
        >
          <CheckCircle2 className="h-7.5 w-7.5 text-accent-success" strokeWidth={1.6} />
          <p className="mt-3 text-body font-medium text-foreground">{t('settings.changeDone')}</p>
          <p className="mt-2 text-label text-foreground-muted">{t('settings.successAddressLabel')}</p>
          <p className="mt-0.5 text-body text-foreground">
            {newUsername}
            <span className="text-foreground-muted">@{NPUBCASH_DOMAIN}</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-6 h-10 w-full rounded-[11px] border border-neutral-300/30 bg-background-card text-[11px] font-medium text-foreground-muted active:scale-[0.98] transition-transform"
          >
            {t('common.close')}
          </button>
        </div>
      ) : null}

      {/* Funding sheet: best source pre-selected, only funded mints shown. */}
      <MintSelectBottomSheet
        isOpen={fundingSheetOpen}
        onClose={() => setFundingSheetOpen(false)}
        onSelect={handleFundingSwap}
        selectedMintUrl={bestSourceMint}
        mintUrls={Object.keys(balance.byMint).filter((url) => url !== funding?.targetMintUrl)}
        filterFn={(m) => (m.balance ?? 0) > 0}
        // Swap moves the whole required amount (fee, or the fee deficit when the
        // payment mint is short only of the send fee), so a source with less
        // than that can never cover it: render it dimmed + "N short" badge.
        getShortage={funding ? (m) => Math.max(0, funding.requiredAmount - (m.balance ?? 0)) : undefined}
        infoText={funding ? t('settings.swapRequiredBody', { amount: formatSats(funding.requiredAmount) }) : undefined}
        buttonLabel={t('settings.pay')}
      />
    </BottomSheet>
  )
}

export default ChangeUsernameSheet
