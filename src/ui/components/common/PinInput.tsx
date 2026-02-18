import { useCallback, useEffect } from 'react'

export interface PinInputProps {
  value: string
  onChange: (value: string) => void
  length?: number
  disabled?: boolean
  error?: string
  label?: string
}

/**
 * 6-digit PIN input component with numeric keypad
 */
export function PinInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  error,
  label,
}: PinInputProps) {
  const handleKeyPress = useCallback((key: string) => {
    if (disabled) return

    if (key === '⌫') {
      onChange(value.slice(0, -1))
    } else if (value.length < length) {
      onChange(value + key)
    }
  }, [disabled, value, length, onChange])

  // Handle physical keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return

      if (e.key >= '0' && e.key <= '9' && value.length < length) {
        onChange(value + e.key)
      } else if (e.key === 'Backspace') {
        onChange(value.slice(0, -1))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [disabled, value, length, onChange])

  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', '⌫'],
  ]

  return (
    <div className="flex flex-col items-center w-full max-w-sm mx-auto">
      {/* Label */}
      {label && (
        <p className="text-muted-foreground mb-4">{label}</p>
      )}

      {/* PIN Dots - dynamic display */}
      <div className="flex gap-3 mb-6 min-h-[16px]">
        {value.length > 0 ? (
          // Show filled dots for entered digits
          [...Array(Math.min(value.length, 10))].map((_, i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-full bg-primary scale-110 transition-all"
            />
          ))
        ) : (
          // Show placeholder dots (6 by default, or specified length up to 6)
          [...Array(Math.min(length, 6))].map((_, i) => (
            <div
              key={i}
              className="w-4 h-4 rounded-full bg-muted transition-all"
            />
          ))
        )}
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-destructive text-xs text-center mb-4">{error}</p>
      )}

      {/* Keypad */}
      <div className="w-full px-3">
        <div className="grid grid-cols-3 gap-3">
          {keys.map((row, rowIndex) =>
            row.map((key, keyIndex) => {
              if (key === '') {
                return <div key={`${rowIndex}-${keyIndex}`} />
              }
              return (
                <button
                  key={`${rowIndex}-${keyIndex}`}
                  type="button"
                  onPointerDown={(e) => { e.preventDefault(); handleKeyPress(key) }}
                  disabled={disabled}
                  className={`
                    py-4 text-xl font-medium rounded-lg transition-all
                    active:scale-95 active:opacity-80 touch-manipulation
                    bg-muted hover:bg-muted/80
                    disabled:opacity-50 disabled:pointer-events-none
                  `}
                >
                  {key}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
