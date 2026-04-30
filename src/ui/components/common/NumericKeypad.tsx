import { memo } from 'react'
import { Delete } from 'lucide-react'

interface NumericKeypadProps {
  onKeyPress: (key: string) => void
  disabled?: boolean
  deleteAriaLabel?: string
}

/**
 * Isolated numeric keypad component.
 * Memoized to prevent re-renders when parent state (e.g., PIN value) changes.
 * Only re-renders when disabled state or callbacks change.
 */
export const NumericKeypad = memo(function NumericKeypad({
  onKeyPress,
  disabled = false,
  deleteAriaLabel = 'Delete',
}: NumericKeypadProps) {
  return (
    <div className="grid grid-cols-3 gap-1 pb-app shrink-0">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
        <button
          key={num}
          onPointerDown={(e) => { e.preventDefault(); onKeyPress(num.toString()) }}
          disabled={disabled}
          className="h-14 rounded-xl text-title font-bold text-foreground hover:bg-foreground/5 active:bg-foreground/10 active:scale-95 flex items-center justify-center disabled:opacity-50 touch-manipulation select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {num}
        </button>
      ))}
      <div />
      <button
        onPointerDown={(e) => { e.preventDefault(); onKeyPress('0') }}
        disabled={disabled}
        className="h-14 rounded-xl text-title font-bold text-foreground hover:bg-foreground/5 active:bg-foreground/10 active:scale-95 flex items-center justify-center disabled:opacity-50 touch-manipulation select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        0
      </button>
      <button
        onPointerDown={(e) => { e.preventDefault(); onKeyPress('delete') }}
        disabled={disabled}
        aria-label={deleteAriaLabel}
        className="h-14 rounded-xl text-foreground hover:bg-foreground/5 active:bg-foreground/10 active:scale-95 flex items-center justify-center disabled:opacity-50 touch-manipulation select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Delete className="w-5 h-5" />
      </button>
    </div>
  )
})
