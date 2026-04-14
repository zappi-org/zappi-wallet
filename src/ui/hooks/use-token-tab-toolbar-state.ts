import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type TokenToolbarState = 'WALLET' | 'TOKEN_TOP' | 'TOKEN_SCROLLED' | 'TOKEN_NAV_OPEN'

interface UseTokenTabToolbarStateInput {
  isTokenTab: boolean
  collapsed: boolean
  scrollRef: RefObject<HTMLElement | null>
  /** Additional scrollTop past the reexpand anchor before auto-collapsing. */
  reexpandThreshold?: number
}

interface UseTokenTabToolbarStateOutput {
  state: TokenToolbarState
  walletMenuOpen: boolean
  setWalletMenuOpen: (v: boolean) => void
  /** Snapshot current scrollTop as the reexpand anchor and force TOKEN_TOP. */
  triggerReexpand: () => void
}

export function useTokenTabToolbarState({
  isTokenTab,
  collapsed,
  scrollRef,
  reexpandThreshold = 40,
}: UseTokenTabToolbarStateInput): UseTokenTabToolbarStateOutput {
  const [walletMenuOpen, setWalletMenuOpen] = useState(false)
  const [reexpand, setReexpand] = useState(false)
  const reexpandAnchorRef = useRef<number | null>(null)

  // Gated reset on tab exit
  useEffect(() => {
    if (!isTokenTab) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset on prop change
      setWalletMenuOpen(false)
      setReexpand(false)
      reexpandAnchorRef.current = null
    }
  }, [isTokenTab])

  // Auto-clear reexpand when user returns to the top,
  // and auto-close the wallet picker when the user scrolls down.
  useEffect(() => {
    if (!collapsed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync reset on prop change
      setReexpand(false)
      reexpandAnchorRef.current = null
    } else {
      setWalletMenuOpen(false)
    }
  }, [collapsed])

  // While reexpand is active, release it once scrollTop exceeds anchor + threshold
  useEffect(() => {
    if (!reexpand) return
    const el = scrollRef.current
    if (!el) return

    const onScroll = () => {
      const anchor = reexpandAnchorRef.current
      if (anchor == null) return
      if (el.scrollTop > anchor + reexpandThreshold) {
        setReexpand(false)
        reexpandAnchorRef.current = null
      }
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [reexpand, scrollRef, reexpandThreshold])

  const triggerReexpand = useCallback(() => {
    const el = scrollRef.current
    reexpandAnchorRef.current = el ? el.scrollTop : 0
    setReexpand(true)
  }, [scrollRef])

  const state: TokenToolbarState = !isTokenTab
    ? 'WALLET'
    : walletMenuOpen
      ? 'TOKEN_NAV_OPEN'
      : !collapsed || reexpand
        ? 'TOKEN_TOP'
        : 'TOKEN_SCROLLED'

  return { state, walletMenuOpen, setWalletMenuOpen, triggerReexpand }
}
