import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../common'
import { useSatUnit, useFormatSats } from '@/utils/format'

export interface KeypadProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  maxLength?: number
  showDisplay?: boolean
  displayLabel?: string
  unit?: string
  balance?: number
  balanceLabel?: string
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['C', '0', '⌫'],
] as const

export function Keypad({
  value,
  onChange,
  disabled = false,
  maxLength = 10,
  showDisplay = true,
  displayLabel,
  unit: _unit = 'sat',
  balance,
  balanceLabel,
}: KeypadProps) {
  const { t } = useTranslation()
  const unit = useSatUnit()
  const formatSats = useFormatSats()
  const resolvedDisplayLabel = displayLabel ?? t('common.amount')
  const resolvedBalanceLabel = balanceLabel ?? t('common.balance')
  const handlePress = useCallback(
    (key: string) => {
      if (disabled) return

      if (key === 'C') {
        onChange('')
        return
      }

      if (key === '⌫') {
        onChange(value.slice(0, -1))
        return
      }

      // Check max length
      if (value.length + 1 > maxLength) return

      // Handle leading zeros
      if (value === '0' && key !== '0') {
        onChange(key)
      } else if (value === '0' && key === '0') {
        // Keep single zero
      } else {
        onChange(value + key)
      }
    },
    [disabled, maxLength, onChange, value]
  )

  const numericValue = useMemo(() => {
    return parseInt(value || '0', 10)
  }, [value])

  const formattedValue = useMemo(() => {
    return numericValue.toLocaleString()
  }, [numericValue])

  // Keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return

      if (e.key >= '0' && e.key <= '9') {
        handlePress(e.key)
      } else if (e.key === 'Backspace') {
        handlePress('⌫')
      } else if (e.key === 'Escape') {
        handlePress('C')
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [disabled, handlePress])

  return (
    <div className={`flex flex-col ${showDisplay ? 'h-full' : ''}`}>
      {/* Display */}
      {showDisplay && (
        <div className="flex-1 flex flex-col justify-center items-center py-6">
          {balance !== undefined ? (
            <p className="text-muted-foreground text-label font-medium mb-2">
              {resolvedBalanceLabel}: {formatSats(balance)}
            </p>
          ) : (
            <p className="text-muted-foreground text-label font-medium mb-2">{resolvedDisplayLabel}</p>
          )}
          {unit === '₿' && <p className="text-muted-foreground text-body mb-1">{unit}</p>}
          <p className="text-display font-bold font-display tabular-nums">
            {formattedValue}
          </p>
          {unit !== '₿' && <p className="text-muted-foreground text-body mt-1">{unit}</p>}
        </div>
      )}

      {/* Keypad Grid */}
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((row, rowIndex) =>
          row.map((key) => (
            <button
              key={`${rowIndex}-${key}`}
              type="button"
              onPointerDown={(e) => { e.preventDefault(); handlePress(key) }}
              disabled={disabled}
              className={`
                min-h-[56px] py-4 text-title font-bold rounded-lg
                active:scale-95 active:opacity-80 touch-manipulation
                ${
                  key === 'C'
                    ? 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                    : key === '⌫'
                    ? 'bg-muted hover:bg-muted/80'
                    : 'bg-muted hover:bg-muted/80'
                }
                disabled:opacity-50 disabled:pointer-events-none
              `}
            >
              {key}
            </button>
          ))
        )}
      </div>
    </div>
  )
}

export interface KeypadWithActionsProps extends KeypadProps {
  onReceive: () => void
  onSend: () => void
  receiveLabel?: string
  sendLabel?: string
  canReceive?: boolean
  canSend?: boolean
}

export function KeypadWithActions({
  onReceive,
  onSend,
  receiveLabel,
  sendLabel,
  canReceive = true,
  canSend = true,
  ...keypadProps
}: KeypadWithActionsProps) {
  const { t } = useTranslation()
  const resolvedReceiveLabel = receiveLabel ?? t('common.receive')
  const resolvedSendLabel = sendLabel ?? t('common.send')
  const amount = parseInt(keypadProps.value || '0', 10)
  const hasAmount = amount > 0

  return (
    <div className="flex flex-col h-full">
      <Keypad {...keypadProps} />

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <Button
          variant="primary"
          size="xl"
          onClick={onReceive}
          disabled={keypadProps.disabled || !canReceive}
          className="font-semibold truncate"
        >
          {resolvedReceiveLabel}
        </Button>
        <Button
          variant="secondary"
          size="xl"
          onClick={onSend}
          disabled={keypadProps.disabled || !hasAmount || !canSend}
          className="font-semibold truncate"
        >
          {resolvedSendLabel}
        </Button>
      </div>
    </div>
  )
}
