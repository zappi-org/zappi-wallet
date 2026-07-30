import { type ReactNode, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  motion,
  AnimatePresence,
  useDragControls,
  useReducedMotion,
  type PanInfo,
  type Transition,
} from 'motion/react'
import { motionSafeTransition } from '@/ui/utils/motion'
import { useEscapeDismiss } from '@/ui/hooks/use-escape-dismiss'
import { useFocusTrap } from '@/ui/hooks/use-focus-trap'
import { useIsActivityTop } from '@/ui/navigation/use-is-activity-top'

export interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  /**
   * Overlay positioning. 'fixed' (default) covers the viewport; 'absolute'
   * confines the sheet to the nearest positioned ancestor so it can slide over
   * an in-flow screen (e.g. the send confirm sheet over the amount step).
   */
  variant?: 'fixed' | 'absolute'
  /** Tailwind z-index classes for backdrop/sheet, letting an in-flow sheet sit below app chrome. */
  backdropZClass?: string
  sheetZClass?: string
  /** Backdrop base class (color); animates opacity to `backdropOpacity`. */
  backdropClassName?: string
  backdropOpacity?: number
  /** Sheet surface class (bg / radius / padding / max-height / overflow). */
  sheetClassName?: string
  /** Enter/exit transition for the sheet slide. Overridden by a fade under reduced motion. */
  transition?: Transition
  /** Backdrop fade transition. Omitted → motion default (preserves legacy consumers). */
  backdropTransition?: Transition
  /** Disable drag-to-dismiss (sheets that must be dismissed via an explicit action). */
  disableDrag?: boolean
  /** Wrap children in a scrollable region (default). Set false for fixed-height content. */
  scrollable?: boolean
  /** Render the default drag handle (default). Set false to supply a custom one in `children`. */
  showHandle?: boolean
  /** Wire the dialog to a heading rendered inside `children` (id) for screen readers. */
  ariaLabelledBy?: string
  /**
   * Lift the sheet off the viewport bottom by this many px — the soft-keyboard
   * inset for sheets holding a text input (`bottom: 0` alone leaves the sheet
   * behind the keyboard on iOS, where the layout viewport does not shrink).
   */
  bottomOffset?: number
  /**
   * Render at document.body. Inside a transformed Stackflow activity `fixed` is
   * trapped in that activity's stacking context, so a sheet opened from a tab
   * screen would paint under the dock; body-level rendering restores true
   * stacking. Pair with `closeWhenCovered`.
   */
  portal?: boolean
  /**
   * Close the sheet when its owning activity stops being the top of the stack.
   * A portalled sheet survives its screen being covered — Stackflow only hides
   * the covered screen's own DOM — so it would stay modal over whatever was
   * pushed on top.
   */
  closeWhenCovered?: boolean
  /**
   * Set false while an action must not be interrupted: backdrop taps, Escape and
   * drag-to-dismiss all stop closing the sheet (the explicit controls stay).
   */
  dismissible?: boolean
}

const DEFAULT_SHEET_CLASS = 'bg-background-elevated rounded-t-lg max-h-[85vh] overflow-hidden'
const DEFAULT_TRANSITION: Transition = { duration: 0.25, ease: 'easeOut' }
/** Past this much travel a press is a drag, not a tap on what sat under it. */
const DRAG_SLOP_PX = 8
/** Movement needed over a carousel before paging vs dismissing is decided. */
const DIRECTION_SLOP_PX = 6

/**
 * Bottom sheet component for scrollable lists and selection UI (Section 17.4)
 * Use for: mint list selection, relay list selection, transaction details.
 *
 * Defaults render a viewport-fixed, drag-to-dismiss sheet with a centered header.
 * The optional props above let callers compose in-flow overlay variants (fixed
 * vs absolute positioning, custom transition, no drag) without forking the
 * backdrop / handle / dialog-a11y machinery.
 */
export function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  variant = 'fixed',
  backdropZClass = 'z-[60]',
  sheetZClass = 'z-[70]',
  backdropClassName = 'bg-black',
  backdropOpacity = 0.5,
  sheetClassName = DEFAULT_SHEET_CLASS,
  transition = DEFAULT_TRANSITION,
  backdropTransition,
  disableDrag = false,
  scrollable = true,
  showHandle = true,
  ariaLabelledBy,
  bottomOffset = 0,
  portal = false,
  closeWhenCovered = false,
  dismissible = true,
}: BottomSheetProps) {
  const reduceMotion = useReducedMotion()
  const dragControls = useDragControls()
  const sheetRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const isTop = useIsActivityTop()

  const { onEntryComplete, restoreFocus } = useFocusTrap(isOpen, sheetRef, backdropRef)

  const requestClose = useCallback(() => {
    if (!dismissible) return
    onClose()
  }, [dismissible, onClose])

  // Closing through the owner keeps `isOpen` the single source of truth; flipping
  // anything locally here would desync it.
  useEffect(() => {
    if (closeWhenCovered && isOpen && !isTop) onClose()
  }, [closeWhenCovered, isOpen, isTop, onClose])

  // Let the caret go the moment the sheet starts leaving. The soft keyboard is
  // tied to focus, so a field still focused through the exit keeps it up until
  // the sheet has already gone — the keyboard then collapses on its own, after
  // the fact. Blurring here starts both retreats together.
  useEffect(() => {
    if (isOpen) return
    const active = document.activeElement
    if (active instanceof HTMLElement && sheetRef.current?.contains(active)) active.blur()
  }, [isOpen])

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.y > 100 || info.velocity.y > 500) {
        requestClose()
      }
    },
    [requestClose],
  )

  /** Nearest scrollable ancestor within the sheet that is actually scrolled. */
  const scrolledAncestor = useCallback((target: EventTarget | null): boolean => {
    let node = target as HTMLElement | null
    while (node && node !== sheetRef.current) {
      if (node.scrollHeight > node.clientHeight && node.scrollTop > 0) {
        const { overflowY } = getComputedStyle(node)
        if (overflowY === 'auto' || overflowY === 'scroll') return true
      }
      node = node.parentElement
    }
    return false
  }, [])

  /** A horizontally paging region (a card carousel) that owns sideways gestures. */
  const horizontalScroller = useCallback((target: EventTarget | null): boolean => {
    let node = target as HTMLElement | null
    while (node && node !== sheetRef.current) {
      if (node.scrollWidth > node.clientWidth) {
        const { overflowX } = getComputedStyle(node)
        if (overflowX === 'auto' || overflowX === 'scroll') return true
      }
      node = node.parentElement
    }
    return false
  }, [])

  const pressOrigin = useRef<{ x: number; y: number } | null>(null)
  const awaitingDirection = useRef(false)

  // The whole surface is the grab area — a 20px bar was the only place the sheet
  // could be pulled from, so dragging it anywhere else did nothing (and on a list
  // it landed as a tap, selecting whatever was under the finger). Content that is
  // scrolled away from its top keeps the gesture; at the top the sheet takes it,
  // which is the usual hand-off. Over a carousel the first few pixels decide:
  // sideways pages, downwards dismisses.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pressOrigin.current = { x: e.clientX, y: e.clientY }
    awaitingDirection.current = false
    if (scrolledAncestor(e.target)) return
    if (horizontalScroller(e.target)) {
      awaitingDirection.current = true
      return
    }
    dragControls.start(e)
  }, [dragControls, scrolledAncestor, horizontalScroller])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!awaitingDirection.current) return
    const origin = pressOrigin.current
    if (!origin) return
    const dx = Math.abs(e.clientX - origin.x)
    const dy = e.clientY - origin.y
    if (Math.max(dx, Math.abs(dy)) < DIRECTION_SLOP_PX) return
    awaitingDirection.current = false
    if (dy > dx) dragControls.start(e)
  }, [dragControls])

  const endDirectionWatch = useCallback(() => { awaitingDirection.current = false }, [])

  /** A press that travelled is a drag, and its click is not a selection. */
  const swallowDragClick = useCallback((e: React.MouseEvent) => {
    const origin = pressOrigin.current
    if (!origin) return
    if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) <= DRAG_SLOP_PX) return
    e.preventDefault()
    e.stopPropagation()
  }, [])

  useEscapeDismiss(isOpen && dismissible, requestClose)

  const position = variant === 'absolute' ? 'absolute' : 'fixed'
  const dragEnabled = !disableDrag && !reduceMotion
  const dragProps = dragEnabled
    ? {
        drag: 'y' as const,
        dragConstraints: { top: 0, bottom: 0 },
        dragElastic: { top: 0, bottom: 0.6 },
        dragControls,
        // Starts are decided in handlePointerDown, which knows about the content's
        // own scrolling; motion must not also arm itself on the bare surface.
        dragListener: false,
        onDragEnd: handleDragEnd,
      }
    : {}

  const titleId = title && typeof title === 'string' ? `${title.replace(/\s+/g, '-').toLowerCase()}-title` : undefined

  const tree = (
    <AnimatePresence onExitComplete={restoreFocus}>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            ref={backdropRef}
            // A sheet opened from inside a Vaul drawer (history filters) sits in
            // that drawer's drag surface — without this, dragging here drags the
            // drawer underneath and collapses it.
            data-vaul-no-drag=""
            initial={{ opacity: 0 }}
            animate={{ opacity: backdropOpacity }}
            exit={{ opacity: 0 }}
            transition={motionSafeTransition(reduceMotion, backdropTransition)}
            className={`${position} inset-0 ${backdropClassName} ${backdropZClass}`}
            style={{ isolation: 'isolate' }}
            onClick={requestClose}
          />

          {/* Sheet */}
          <motion.div
            ref={sheetRef}
            data-vaul-no-drag=""
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            aria-labelledby={ariaLabelledBy ?? titleId}
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
            {...dragProps}
            transition={motionSafeTransition(reduceMotion, transition)}
            onAnimationComplete={onEntryComplete}
            onPointerDown={dragEnabled ? handlePointerDown : undefined}
            onPointerMove={dragEnabled ? handlePointerMove : undefined}
            onPointerUp={endDirectionWatch}
            onPointerCancel={endDirectionWatch}
            onClickCapture={dragEnabled ? swallowDragClick : undefined}
            className={`${position} left-0 right-0 ${sheetClassName} ${sheetZClass} outline-none`}
            style={{ bottom: bottomOffset }}
          >
            {/* Handle — the visual grabber; the whole sheet is the grab area. */}
            {showHandle && (
              <div className="flex justify-center py-2.5 cursor-grab active:cursor-grabbing touch-none">
                <div className="w-10 h-1 bg-foreground-subtle rounded-full" />
              </div>
            )}

            {/* Header */}
            {title && (
              <div className="px-5 pb-3 border-b border-foreground-subtle/20 touch-none">
                <h3 id={titleId} className="text-subtitle font-semibold text-foreground text-center">{title}</h3>
              </div>
            )}

            {/* Content area — overscroll contained so a list at its end doesn't
                hand the gesture back to whatever is behind the sheet, and padded
                so the last row clears the screen edge (and the home indicator
                under it) instead of ending flush against it. Sheets that lay out
                their own bottom edge opt out with `scrollable={false}`. */}
            {scrollable ? (
              <div className="overflow-y-auto overscroll-contain pb-app max-h-[calc(85vh-60px)]">{children}</div>
            ) : (
              children
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  return portal ? createPortal(tree, document.body) : tree
}

/**
 * Bottom sheet list item
 */
export interface BottomSheetItemProps {
  icon?: ReactNode
  title: string
  subtitle?: string
  selected?: boolean
  disabled?: boolean
  onClick?: () => void
}

export function BottomSheetItem({
  icon,
  title,
  subtitle,
  selected,
  disabled,
  onClick,
}: BottomSheetItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      // aria-selected is not allowed on a plain button (AT drops it), and the
      // check glyph below is decorative — aria-pressed is what actually
      // announces "선택됨" here.
      aria-pressed={selected}
      className={`
        w-full flex items-center gap-3 px-5 py-3 min-h-[48px] text-left
        active:scale-95 active:opacity-80 transition-all duration-100
        ${selected ? 'bg-accent-primary/10' : 'hover:bg-foreground-subtle/10'}
        ${disabled ? 'opacity-50 pointer-events-none' : ''}
      `}
    >
      {icon && <span className="text-foreground-muted">{icon}</span>}
      <div className="flex-1 min-w-0">
        <div className={`text-body ${selected ? 'text-accent-primary' : 'text-foreground'}`}>
          {title}
        </div>
        {subtitle && (
          <div className="text-overline font-medium text-foreground-muted truncate">{subtitle}</div>
        )}
      </div>
      {selected && (
        <span className="text-accent-primary text-caption" aria-hidden="true">✓</span>
      )}
    </button>
  )
}
