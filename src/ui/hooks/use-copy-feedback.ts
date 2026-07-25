/**
 * useCopyFeedback — the one way this app confirms a copy or a share.
 *
 * haptic.ts rides on navigator.vibrate, which iOS Safari and iOS PWAs do not
 * implement, so a haptic can never be the signal. Every action here therefore
 * produces both a visual state change (isCopied/isShared, 2s) and a toast; the
 * haptic is a bonus on the platforms that have it.
 *
 * `field` lets one hook drive a screen full of rows — pass a key per row, or
 * omit it on single-payload screens.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { hapticTap } from '@/ui/utils/haptic'
import { shareOrCopyText, writeClipboardText, type ShareOutcome } from '@/ui/utils/share'

const DEFAULT_FIELD = '__default__'
const FEEDBACK_MS = 2000
const TOAST_MS = 2000

type Confirmed = { field: string; kind: 'copied' | 'shared' }

export interface UseCopyFeedback {
  /** True while this field's copy confirmation is showing. */
  isCopied: (field?: string) => boolean
  /** True while this field's share confirmation is showing. */
  isShared: (field?: string) => boolean
  copy: (text: string, field?: string) => Promise<boolean>
  share: (text: string, field?: string) => Promise<ShareOutcome>
}

export function useCopyFeedback(resetMs: number = FEEDBACK_MS): UseCopyFeedback {
  const { t } = useTranslation()
  const addToast = useAppStore((s) => s.addToast)
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const flash = useCallback(
    (field: string, kind: Confirmed['kind']) => {
      setConfirmed({ field, kind })
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        setConfirmed(null)
        timerRef.current = null
      }, resetMs)
    },
    [resetMs],
  )

  const succeed = useCallback(
    (field: string, kind: Confirmed['kind']) => {
      flash(field, kind)
      hapticTap()
      addToast({
        type: 'success',
        message: kind === 'shared' ? t('toast.shared') : t('toast.copied'),
        duration: TOAST_MS,
      })
    },
    [flash, addToast, t],
  )

  const fail = useCallback(() => {
    addToast({ type: 'error', message: t('toast.copyFailed'), duration: 3000 })
  }, [addToast, t])

  const copy = useCallback(
    async (text: string, field: string = DEFAULT_FIELD) => {
      if (!text) return false
      const ok = await writeClipboardText(text)
      if (ok) succeed(field, 'copied')
      else fail()
      return ok
    },
    [succeed, fail],
  )

  const share = useCallback(
    async (text: string, field: string = DEFAULT_FIELD): Promise<ShareOutcome> => {
      if (!text) return 'failed'
      const outcome = await shareOrCopyText(text)
      // A cancel is the user's own decision — announcing it would be noise.
      if (outcome === 'shared' || outcome === 'copied') succeed(field, outcome)
      else if (outcome === 'failed') fail()
      return outcome
    },
    [succeed, fail],
  )

  const isCopied = useCallback(
    (field: string = DEFAULT_FIELD) => confirmed?.kind === 'copied' && confirmed.field === field,
    [confirmed],
  )
  const isShared = useCallback(
    (field: string = DEFAULT_FIELD) => confirmed?.kind === 'shared' && confirmed.field === field,
    [confirmed],
  )

  return { isCopied, isShared, copy, share }
}
