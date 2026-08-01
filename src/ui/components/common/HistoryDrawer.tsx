import { lazy, Suspense, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from 'motion/react'
import { useTranslation } from 'react-i18next'
import { LoadingFallback } from '@/ui/components/common/LoadingFallback'
import type { Transaction } from '@/core/domain/transaction'
import { useEscapeDismiss } from '@/ui/hooks/use-escape-dismiss'
import { useFocusTrap } from '@/ui/hooks/use-focus-trap'
import { useIsActivityTop } from '@/ui/navigation/use-is-activity-top'
import { sheetSettleMs, SHEET_EASE } from '@/ui/utils/motion'
import type { PendingItemDetailCallbacks } from '@/ui/screens/MintDetail/PendingItemDetailScreen'

const HistoryScreen = lazy(() => import('@/ui/screens/History/HistoryScreen'))

/** Open height, leaving the pushed-back shell visible above the sheet. */
const SHEET_HEIGHT_RATIO = 0.94
/** Matches the shared sheet: same scrim weight, same presentation curve. */
const SCRIM_OPACITY = 0.5
/** Past this much travel a press is a drag, not a tap on what sat under it. */
const DRAG_SLOP_PX = 8
/** Movement needed over the list before scrolling vs dismissing is decided. */
const DIRECTION_SLOP_PX = 6
/** Past this much of the travel, a drag has committed to the other state. */
const COMMIT_FRACTION = 0.25
/** A release faster than this decides on its own, however far it got. */
const FLICK_VELOCITY = 500

export interface HistoryDrawerProps {
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  /** Home's own newest-transaction row, which the sheet slides over and back off. */
  peek: ReactNode
  transactions: Transaction[]
  initialMintUrls?: string[]
  pendingItemCallbacks?: PendingItemDetailCallbacks
}

/**
 * Home's transaction history as a sheet that slides over the screen.
 *
 * The peek row stays where home draws it and never moves: the sheet travels the
 * full height of its own box, so opening covers the row and closing uncovers it.
 * The gesture starts on that row rather than on the sheet — closed, the sheet is
 * off the bottom of the screen and there is nothing there to grab — which is
 * what `dragListener={false}` plus an external `dragControls.start` is for.
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
  const reduceMotion = useReducedMotion()
  const dragControls = useDragControls()
  const sheetRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const isTop = useIsActivityTop()

  const collapse = useCallback(() => onExpandedChange(false), [onExpandedChange])

  const { onEntryComplete, restoreFocus } = useFocusTrap(expanded, sheetRef, scrimRef)
  useEscapeDismiss(expanded, collapse)

  // The sheet never unmounts, so the trap is driven by the open state instead of
  // by mount/unmount: take focus once open, hand it back on close.
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

  /** Closed sits the sheet on its own height — entirely below the viewport. */
  const closedY = Math.ceil(viewportHeight * SHEET_HEIGHT_RATIO)
  const y = useMotionValue(closedY)
  // The scrim belongs to the sheet's position, not to the state it ends in: it
  // follows the finger on the way up and lifts on the way down, in step.
  const scrimOpacity = useTransform(
    y,
    (value) => Math.min(1, Math.max(0, 1 - value / closedY)) * SCRIM_OPACITY,
  )

  // Timed from the distance left to cover, on the same formula as every other
  // sheet — a release halfway up finishes in less than a full presentation.
  const settleTo = useCallback(
    (open: boolean) => {
      const target = open ? 0 : closedY
      const duration = sheetSettleMs(Math.abs(y.get() - target), viewportHeight) / 1000
      animate(y, target, reduceMotion ? { duration: 0 } : { duration, ease: SHEET_EASE })
    },
    [y, closedY, viewportHeight, reduceMotion],
  )

  useEffect(() => { settleTo(expanded) }, [expanded, settleTo])

  // Warm the history chunk while the sheet is still closed, so the first open
  // doesn't wait on the network for its content.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1))
    idle(() => { void import('@/ui/screens/History/HistoryScreen') })
  }, [])

  // The list mounts on the first drag rather than on release, so it is already
  // there under the finger. It is never mounted on a home that was only looked
  // at: HistoryScreen kicks off a reconcile on mount, which has no business
  // running until the user reaches for the ledger.
  const [listMounted, setListMounted] = useState(expanded)
  useEffect(() => {
    if (expanded) setListMounted(true)
  }, [expanded])

  // HistoryScreen seeds its mint filter once, at mount. Since the list stays
  // mounted between opens, swiping to another card would otherwise leave it
  // showing the previous mint's ledger. Drop it while closed so the next drag
  // mounts it against the card the user is actually on — and remount via `key`
  // for the case where it is already open.
  const mintKey = initialMintUrls?.join('|') ?? 'all'
  const lastMintKey = useRef(mintKey)
  if (lastMintKey.current !== mintKey) {
    lastMintKey.current = mintKey
    if (!expanded && listMounted) setListMounted(false)
  }

  const handleDragStart = useCallback(() => setListMounted(true), [])

  // Measured against where the drag began, not against the midpoint of the
  // screen: from open, letting go halfway down should close, and asking for half
  // the sheet's height before it commits means it never does.
  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const travelled = expanded ? y.get() : closedY - y.get()
      const committed = travelled >= closedY * COMMIT_FRACTION
      const open =
        Math.abs(info.velocity.y) > FLICK_VELOCITY
          ? info.velocity.y < 0
          : expanded
            ? !committed
            : committed
      // A drag that ends on the side it started changes no state, so nothing
      // would animate it home; settle it here instead.
      if (open === expanded) settleTo(open)
      else onExpandedChange(open)
    },
    [y, closedY, expanded, settleTo, onExpandedChange],
  )

  /** Nearest scrollable ancestor within the sheet, if the press is over one. */
  const verticalScroller = useCallback((target: EventTarget | null): HTMLElement | null => {
    let node = target as HTMLElement | null
    while (node && node !== sheetRef.current) {
      if (node.scrollHeight > node.clientHeight) {
        const { overflowY } = getComputedStyle(node)
        if (overflowY === 'auto' || overflowY === 'scroll') return node
      }
      node = node.parentElement
    }
    return null
  }, [])

  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const awaitingDirection = useRef(false)

  const startFromPeek = useCallback((event: React.PointerEvent) => {
    pressOrigin.current = { x: event.clientX, y: event.clientY }
    dragControls.start(event)
  }, [dragControls])

  // The whole sheet is the grab area. A list scrolled away from its top keeps
  // the gesture; at the top the first few pixels decide — downwards dismisses,
  // upwards is left to the scroller.
  const handleSheetPointerDown = useCallback((event: React.PointerEvent) => {
    pressOrigin.current = { x: event.clientX, y: event.clientY }
    awaitingDirection.current = false
    const target = event.target as HTMLElement | null
    // Sheets opened from inside this one (the history filters) sit in its drag
    // surface — without this, dragging them drags the sheet underneath.
    if (target?.closest('[data-sheet-no-drag]')) return
    const scroller = verticalScroller(target)
    if (scroller) {
      if (scroller.scrollTop > 0) return
      awaitingDirection.current = true
      return
    }
    dragControls.start(event)
  }, [dragControls, verticalScroller])

  const handleSheetPointerMove = useCallback((event: React.PointerEvent) => {
    if (!awaitingDirection.current) return
    const origin = pressOrigin.current
    if (!origin) return
    const dy = event.clientY - origin.y
    if (Math.abs(dy) < DIRECTION_SLOP_PX) return
    awaitingDirection.current = false
    if (dy > 0) dragControls.start(event)
  }, [dragControls])

  const endDirectionWatch = useCallback(() => { awaitingDirection.current = false }, [])

  // Dragging the peek row upwards would otherwise also count as a tap on it and
  // open that transaction behind the sheet you just pulled up. A pointer that
  // travelled is a drag, and its click is not the user's intent.
  const swallowDragClick = useCallback((event: React.MouseEvent) => {
    // Keyboard and assistive-tech activations carry no pointer position, so
    // comparing them against the last drag's origin would swallow them.
    if (event.detail === 0) return
    const origin = pressOrigin.current
    if (!origin) return
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) <= DRAG_SLOP_PX) return
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return (
    <>
      {/* Home's own bottom edge: in flow, and untouched by the sheet passing
          over it. `touch-action: none` because this row is where the drag is
          picked up — left to the browser it would scroll-bounce the webview. */}
      <div
        className="mt-auto shrink-0"
        style={{ touchAction: 'none' }}
        onPointerDown={startFromPeek}
        onClickCapture={swallowDragClick}
      >
        {peek}
      </div>

      {/* Body-level, so `fixed` escapes the activity's transform and the sheet
          paints over the dock instead of under it. Dropped while home is
          covered: a portalled sheet would otherwise outlive its screen. */}
      {isTop && createPortal(
        <>
          <motion.div
            ref={scrimRef}
            aria-hidden
            onClick={collapse}
            className="fixed inset-0 z-[55] bg-black"
            style={{ opacity: scrimOpacity, pointerEvents: expanded ? 'auto' : 'none' }}
          />
          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('history.title')}
            aria-hidden={!expanded}
            tabIndex={-1}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: closedY }}
            dragElastic={0}
            dragMomentum={false}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onPointerDown={handleSheetPointerDown}
            onPointerMove={handleSheetPointerMove}
            onPointerUp={endDirectionWatch}
            onPointerCancel={endDirectionWatch}
            onClickCapture={swallowDragClick}
            className="fixed inset-x-0 bottom-0 z-[60] flex h-[94%] flex-col overflow-hidden rounded-t-[32px] bg-white outline-none"
            style={{ y, pointerEvents: expanded ? 'auto' : 'none' }}
          >
            <div className="flex shrink-0 touch-none justify-center pt-3 pb-2">
              <div className="h-1 w-10 rounded-full bg-foreground-subtle" />
            </div>

            <div className="relative min-h-0 flex-1">
              {listMounted && (
                <Suspense fallback={<LoadingFallback />}>
                  <HistoryScreen
                    key={mintKey}
                    onBack={collapse}
                    transactions={transactions}
                    initialMintUrls={initialMintUrls}
                    pendingItemCallbacks={pendingItemCallbacks}
                    isSheet
                    sheetExpanded={expanded}
                  />
                </Suspense>
              )}
            </div>
          </motion.div>
        </>,
        document.body,
      )}
    </>
  )
}
