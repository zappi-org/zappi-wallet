import { useCallback, useEffect } from 'react'
import { NumericKeypad } from './NumericKeypad'

export interface PinInputProps {
  value: string
  onChange: (value: string) => void
  length?: number
  disabled?: boolean
  error?: string
  label?: string
  /** When provided, renders a submit button below the keypad */
  submitLabel?: string
  /** Called when submit button is pressed (requires submitLabel) */
  onSubmit?: () => void
  /** Shows loading state on submit button */
  loading?: boolean
}

export function PinInput({
  value,
  onChange,
  length = 6,
  disabled = false,
  error,
  label,
  submitLabel,
  onSubmit,
  loading = false,
}: PinInputProps) {
  const handleKeyPress = useCallback((key: string) => {
    if (disabled) return

    if (key === 'delete') {
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

  const isComplete = value.length === length
  const isSubmitDisabled = !isComplete || disabled || loading

  return (
    <div className="flex flex-col items-center w-full max-w-sm mx-auto">
      {label && (
        <p className="text-foreground-muted text-caption mb-4">{label}</p>
      )}

      {/* PIN Dots */}
      <div className="flex gap-4 mb-6 min-h-[16px]">
        {Array.from({ length }, (_, i) => (
          <div
            key={i}
            className="w-4 h-4 rounded-full transition-transform"
            style={{
              transform: i < value.length ? 'scale(1)' : 'scale(0.75)',
              backgroundColor: i < value.length
                ? 'var(--brand)'
                : 'color-mix(in srgb, var(--brand) 20%, transparent)',
            }}
          />
        ))}
      </div>

      {error && (
        <p className="text-accent-danger text-label text-center mb-4">{error}</p>
      )}

      <div className="w-full">
        <NumericKeypad onKeyPress={handleKeyPress} disabled={disabled} />
      </div>

      {submitLabel && (
        <button
          onClick={onSubmit}
          disabled={isSubmitDisabled}
          className={`
            w-full py-3.5 rounded-[14px] font-semibold text-body transition-all
            ${isSubmitDisabled
              ? 'bg-muted text-foreground/30 cursor-not-allowed'
              : 'bg-brand text-white shadow-lg shadow-brand/25 active:scale-[0.98]'}
          `}
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          ) : (
            submitLabel
          )}
        </button>
      )}
    </div>
  )
}
