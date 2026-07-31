import { lazy, Suspense, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Drawer } from 'vaul'
import { useTranslation } from 'react-i18next'
import { LoadingFallback } from '@/ui/components/common/LoadingFallback'
import type { Transaction } from '@/core/domain/transaction'
import { useEscapeDismiss } from '@/ui/hooks/use-escape-dismiss'
import { useFocusTrap } from '@/ui/hooks/use-focus-trap'
import type { PendingItemDetailCallbacks } from '@/ui/screens/MintDetail/PendingItemDetailScreen'

const HistoryScreen = lazy(() => import('@/ui/screens/History/HistoryScreen'))

/** Expanded height, leaving the pushed-back shell visible above the sheet. */
const SHEET_HEIGHT_RATIO = 0.94
/** Collapsed: the peek row + clearance for the glass dock it sits behind. */
const PEEK_VISIBLE_PX = 220
const FULL_SNAP = 1
/** Past this much travel a press is a drag, not a tap on what sat under it. */
const DRAG_SLOP_PX = 8
/** Matches the shared sheet: same scrim weight, same presentation curve. */
const SCRIM_OPACITY = 0.5
const SHEET_EASE = 'var(--sheet-ease)'
const SHEET_MS = 500

/**
 * Vaul measures a px snap point from the top of the drawer element, not from the
 * bottom of the viewport — with a 94%-tall sheet a literal 236px would show only
 * 184px. Add back the gap the sheet leaves at the top.
 */
function peekSnapFor(viewportHeight: number): string {
  return `${Math.round(viewportHeight * (1 - SHEET_HEIGHT_RATIO) + PEEK_VISIBLE_PX)}px`
}

export interface HistoryDrawerProps {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  /** Collapsed content — the newest ledger row, shown in place of the old home card. */
  peek: ReactNode
  transactions: Transaction[]
  initialMintUrls?: string[]
  pendingItemCallbacks?: PendingItemDetailCallbacks
}

/**
 * Home's transaction history as a persistent two-detent drawer.
 *
 * Replaces the pan-recognizer + overlay pair: the sheet itself is the gesture
 * target, so dragging tracks the finger from the first pixel and the webview
 * never sees an unconsumed vertical drag to bounce on.
 *
 * The z-index flips with the detent: below the dock (z-50) while collapsed so the
 * tab bar stays usable, above it once expanded so the sheet is not pierced by it.
 */
export function HistoryDrawer({
  expanded,
  onExpandedChange,
  peek,
  transactions,
  initialMintUrls,
  pendingItemCallbacks,
}: HistoryDrawerProps) {
  const { t } = useTranslation()
  const contentRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)

  const collapse = useCallback(() => onExpandedChange(false), [onExpandedChange])

  // The sheet lives in a portal that mounts after this component's own layout
  // effects, so the trap has to wait for the node: arming it on `expanded` alone
  // would run against a null container and never mark the background inert.
  const [contentReady, setContentReady] = useState(false)
  const setContentNode = useCallback((node: HTMLDivElement | null) => {
    contentRef.current = node
    setContentReady(Boolean(node))
  }, [])
  const { onEntryComplete, restoreFocus } = useFocusTrap(
    expanded && contentReady,
    contentRef,
    scrimRef,
  )
  useEscapeDismiss(expanded, collapse)

  // The drawer never unmounts, so the trap is driven by the detent instead of by
  // mount/unmount: take focus once expanded, hand it back on collapse.
  useEffect(() => {
    if (expanded) onEntryComplete()
    else restoreFocus()
  }, [expanded, onEntryComplete, restoreFocus])

  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window === 'undefined' ? 874 : window.innerHeight,
  )
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const peekSnap = useMemo(() => peekSnapFor(viewportHeight), [viewportHeight])
  const snapPoints = useMemo(() => [peekSnap, FULL_SNAP], [peekSnap])
  const activeSnapPoint = expanded ? FULL_SNAP : peekSnap

  const setActiveSnapPoint = useCallback(
    (snap: number | string | null) => onExpandedChange(snap === FULL_SNAP),
    [onExpandedChange],
  )

  // Warm the history chunk while the drawer is still collapsed, so the first
  // expand doesn't wait on the network for its content.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1))
    idle(() => { void import('@/ui/screens/History/HistoryScreen') })
  }, [])

  // The list mounts on the first drag rather than on expand, so the two layers
  // can cross-fade instead of the content swapping after the snap lands. It is
  // never mounted on a home that was only ever looked at: HistoryScreen kicks off
  // a reconcile on mount, which has no business running until the user reaches
  // for the ledger.
  const [listMounted, setListMounted] = useState(expanded)
  useEffect(() => {
    if (expanded) setListMounted(true)
  }, [expanded])

  // HistoryScreen seeds its mint filter once, at mount. Now that the list stays
  // mounted between detents, swiping to another card would otherwise leave it
  // showing the previous mint's ledger. Drop it while collapsed so the next drag
  // mounts it against the card the user is actually on — and remount via `key`
  // for the case where it is already open.
  const mintKey = initialMintUrls?.join('|') ?? 'all'
  const lastMintKey = useRef(mintKey)
  if (lastMintKey.current !== mintKey) {
    lastMintKey.current = mintKey
    if (!expanded && listMounted) setListMounted(false)
  }

  // The sheet material shows up as soon as the drag starts, not when the snap
  // lands: pulling a transparent surface reads as home flying up, pulling a white
  // one reads as a sheet being lifted.
  const [dragging, setDragging] = useState(false)
  const surfaced = expanded || dragging

  // The scrim belongs to the sheet's position, not to the detent it ends on: it
  // follows the finger while dragging and settles on the same curve and duration
  // as every other sheet in the app. Written straight to the node during a drag —
  // a state update per frame would be a re-render per frame.
  const dimProgress = useRef(expanded ? 1 : 0)
  const peekTop = viewportHeight - PEEK_VISIBLE_PX
  const fullTop = viewportHeight * (1 - SHEET_HEIGHT_RATIO)
  const trackDrag = useCallback(() => {
    setListMounted(true)
    setDragging(true)
    const node = contentRef.current
    if (!node) return
    const progress = (peekTop - node.getBoundingClientRect().y) / (peekTop - fullTop)
    dimProgress.current = Math.min(1, Math.max(0, progress))
    if (scrimRef.current) scrimRef.current.style.opacity = String(dimProgress.current * SCRIM_OPACITY)
  }, [peekTop, fullTop])

  const settleDim = useCallback(() => {
    setDragging(false)
    dimProgress.current = expanded ? 1 : 0
  }, [expanded])

  // Two ways out of the dragging state, because leaving it to vaul's onRelease
  // alone is what made the X button leave the shell dimmed under a white sheet
  // on device: the press that hit it was enough of a drag to arm this, the
  // release never came back, and the surface and scrim both read that stale flag.
  // A pointer that ended anywhere ends the drag, and reaching a detent settles it
  // regardless of which callbacks fired.
  useEffect(() => {
    if (!dragging) return
    const end = () => setDragging(false)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging])

  useEffect(() => {
    setDragging(false)
    dimProgress.current = expanded ? 1 : 0
    if (scrimRef.current) {
      scrimRef.current.style.opacity = String(dimProgress.current * SCRIM_OPACITY)
    }
  }, [expanded])

  // Dragging the peek row upwards would otherwise also count as a tap on it and
  // open that transaction behind the sheet you just pulled up. A pointer that
  // travelled is a drag, and its click is not the user's intent.
  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const notePress = useCallback((event: React.PointerEvent) => {
    pressOrigin.current = { x: event.clientX, y: event.clientY }
  }, [])
  const swallowDragClick = useCallback((event: React.MouseEvent) => {
    const origin = pressOrigin.current
    if (!origin) return
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= DRAG_SLOP_PX) return
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return (
    <Drawer.Root
      open
      dismissible={false}
      // Constant on purpose: vaul 1.1.2's Overlay calls a hook after an early
      // `if (!modal) return null`, so flipping this at runtime throws
      // "Rendered more hooks than during the previous render". We own the scrim
      // instead — which is also what keeps home tappable at the peek detent.
      modal={false}
      snapPoints={snapPoints}
      activeSnapPoint={activeSnapPoint}
      setActiveSnapPoint={setActiveSnapPoint}
      fadeFromIndex={1}
      // Our own keyboard inset handling applies here too: Vaul's viewport math
      // has thrown sheets to the top of the screen on iOS (see MemoSheet).
      repositionInputs={false}
      onDrag={trackDrag}
      onRelease={settleDim}
    >
      <Drawer.Portal>
        <div
          ref={scrimRef}
          aria-hidden
          onClick={collapse}
          className={`fixed inset-0 bg-black motion-reduce:transition-none ${expanded ? 'z-[55]' : 'z-30'}`}
          style={{
            opacity: (dragging ? dimProgress.current : expanded ? 1 : 0) * SCRIM_OPACITY,
            transition: dragging ? 'none' : `opacity ${SHEET_MS}ms ${SHEET_EASE}`,
            pointerEvents: expanded ? 'auto' : 'none',
          }}
        />
        <Drawer.Content
          ref={setContentNode}
          aria-describedby={undefined}
          // Collapsed the drawer is only a drag surface: home's own background has
          // to stay visible behind the peek row, which is what it sat on before.
          // The sheet material appears with the expanded detent.
          className={`fixed inset-x-0 bottom-0 flex h-[94%] flex-col outline-none transition-[background-color,border-radius] duration-200 motion-reduce:transition-none ${
            expanded ? 'z-[60]' : 'z-40'
          } ${surfaced ? 'rounded-t-[32px] bg-white' : 'rounded-t-none bg-transparent'}`}
        >
          {/* The grabber belongs to the expanded sheet — collapsed, the peek row
              is home's own bottom edge and carried no bar before. */}
          <div
            className="flex shrink-0 justify-center overflow-hidden transition-all duration-200 motion-reduce:transition-none"
            style={{ height: expanded ? 22 : 12, opacity: expanded ? 1 : 0 }}
          >
            <Drawer.Handle className="!mt-3 !h-1 !w-10 !bg-foreground-subtle" />
          </div>

          <Drawer.Title className="sr-only">{t('history.title')}</Drawer.Title>

          {/* Both detents' content live in the same box and cross-fade, so the
              swap doesn't land as a jump once the snap settles. */}
          <div className="relative min-h-0 flex-1">
            {listMounted && (
              <div
                className="absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none"
                style={{ opacity: expanded ? 1 : 0, pointerEvents: expanded ? 'auto' : 'none' }}
                aria-hidden={!expanded}
              >
                <Suspense fallback={<LoadingFallback />}>
                  <HistoryScreen
                    key={mintKey}
                    onBack={() => onExpandedChange(false)}
                    transactions={transactions}
                    initialMintUrls={initialMintUrls}
                    pendingItemCallbacks={pendingItemCallbacks}
                    isSheet
                  />
                </Suspense>
              </div>
            )}
            <div
              className="absolute inset-x-0 top-0 pb-app-nav transition-opacity duration-200 motion-reduce:transition-none"
              style={{ opacity: expanded ? 0 : 1, pointerEvents: expanded ? 'none' : 'auto' }}
              aria-hidden={expanded}
              onPointerDownCapture={notePress}
              onClickCapture={swallowDragClick}
            >
              {peek}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
