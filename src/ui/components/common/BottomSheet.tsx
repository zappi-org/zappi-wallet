import { type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'

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
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black z-[60]"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed bottom-0 left-0 right-0 bg-background-elevated rounded-t-lg max-h-[70vh] overflow-hidden z-[70]"
          >
            {/* Handle */}
            <div className="flex justify-center py-2">
              <div className="w-8 h-1 bg-foreground-subtle rounded-full" />
            </div>

            {/* Header */}
            {title && (
              <div className="px-2.5 pb-1.5 border-b border-foreground-subtle/20">
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
              </div>
            )}

            {/* Scrollable content area */}
            <div className="overflow-y-auto max-h-[calc(70vh-60px)] pb-safe">
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
        w-full flex items-center gap-1.5 p-3 min-h-[44px] text-left
        active:scale-95 active:opacity-80 transition-all duration-100
        ${selected ? 'bg-accent-primary/10' : 'hover:bg-foreground-subtle/10'}
        ${disabled ? 'opacity-50 pointer-events-none' : ''}
      `}
    >
      {icon && <span className="text-foreground-muted">{icon}</span>}
      <div className="flex-1 min-w-0">
        <div className={`text-xs ${selected ? 'text-accent-primary' : 'text-foreground'}`}>
          {title}
        </div>
        {subtitle && (
          <div className="text-[10px] text-foreground-muted truncate">{subtitle}</div>
        )}
      </div>
      {selected && (
        <span className="text-accent-primary text-sm" aria-hidden="true">✓</span>
      )}
    </button>
  )
}
