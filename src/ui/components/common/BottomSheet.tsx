import { type ReactNode, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion, type PanInfo, type Transition } from 'motion/react'
import { motionSafeTransition } from '@/ui/utils/motion'

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
}

const DEFAULT_SHEET_CLASS = 'bg-background-elevated rounded-t-lg max-h-[85vh] overflow-hidden'
const DEFAULT_TRANSITION: Transition = { duration: 0.25, ease: 'easeOut' }

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
}: BottomSheetProps) {
  const reduceMotion = useReducedMotion()
  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.y > 100 || info.velocity.y > 500) {
        onClose()
      }
    },
    [onClose],
  )

  const position = variant === 'absolute' ? 'absolute' : 'fixed'
  const dragProps =
    disableDrag || reduceMotion
      ? {}
      : {
          drag: 'y' as const,
          dragConstraints: { top: 0, bottom: 0 },
          dragElastic: { top: 0, bottom: 0.6 },
          onDragEnd: handleDragEnd,
        }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: backdropOpacity }}
            exit={{ opacity: 0 }}
            transition={motionSafeTransition(reduceMotion, backdropTransition)}
            className={`${position} inset-0 ${backdropClassName} ${backdropZClass}`}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={ariaLabelledBy}
            initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
            animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
            {...dragProps}
            transition={motionSafeTransition(reduceMotion, transition)}
            className={`${position} bottom-0 left-0 right-0 ${sheetClassName} ${sheetZClass}`}
          >
            {/* Handle */}
            {showHandle && (
              <div className="flex justify-center py-2.5 cursor-grab active:cursor-grabbing touch-none">
                <div className="w-10 h-1 bg-foreground-subtle rounded-full" />
              </div>
            )}

            {/* Header */}
            {title && (
              <div className="px-5 pb-3 border-b border-foreground-subtle/20">
                <h3 className="text-subtitle font-semibold text-foreground text-center">{title}</h3>
              </div>
            )}

            {/* Content area */}
            {scrollable ? (
              <div className="overflow-y-auto max-h-[calc(85vh-60px)]">{children}</div>
            ) : (
              children
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
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
      aria-selected={selected}
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
