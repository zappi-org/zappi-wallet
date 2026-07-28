import { type ReactNode, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence, type PanInfo, useDragControls, useReducedMotion } from 'motion/react'

export interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
}

/**
 * Bottom sheet component for scrollable lists and selection UI (Section 17.4)
 * Use for: mint list selection, relay list selection, transaction details
 */
export function BottomSheet({ isOpen, onClose, title, children }: BottomSheetProps) {
  const dragControls = useDragControls()
  const sheetRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const reducedMotion = useReducedMotion()

  const handleFocusEntry = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement
    sheetRef.current?.focus()
  }, [])

  const handleFocusReturn = useCallback(() => {
    previousFocusRef.current?.focus()
    previousFocusRef.current = null
  }, [])

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      if (info.offset.y > 100 || info.velocity.y > 500) {
        onClose()
      }
    },
    [onClose],
  )

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragControls.start(e)
  }, [dragControls])

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  const transition = reducedMotion
    ? { duration: 0.01 }
    : { duration: 0.25, ease: 'easeOut' as const }

  const titleId = title && typeof title === 'string' ? `${title.replace(/\s+/g, '-').toLowerCase()}-title` : undefined

  return (
    <AnimatePresence onExitComplete={handleFocusReturn}>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            transition={reducedMotion ? { duration: 0.01 } : { duration: 0.2 }}
            className="fixed inset-0 bg-black z-[60]"
            style={{ isolation: 'isolate' }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={typeof title === 'string' ? title : undefined}
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragControls={dragControls}
            dragListener={false}
            onDragEnd={handleDragEnd}
            transition={transition}
            onAnimationComplete={handleFocusEntry}
            className="fixed bottom-0 left-0 right-0 bg-background-elevated rounded-t-lg max-h-[85vh] overflow-hidden z-[70] outline-none"
          >
            {/* Handle */}
            <div
              className="flex justify-center py-2.5 cursor-grab active:cursor-grabbing touch-none"
              onPointerDown={handlePointerDown}
            >
              <div className="w-10 h-1 bg-foreground-subtle rounded-full" />
            </div>

            {/* Header */}
            {title && (
              <div className="px-5 pb-3 border-b border-foreground-subtle/20">
                <h3 id={titleId} className="text-subtitle font-semibold text-foreground text-center">{title}</h3>
              </div>
            )}

            {/* Scrollable content area */}
            <div className="overflow-y-auto max-h-[calc(85vh-60px)]">
              {children}
            </div>
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
