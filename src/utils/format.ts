import { useCallback } from 'react'
import { useAppStore } from '@/store'

type UnitDisplay = 'bip177' | 'sats'

function getUnitDisplay(): UnitDisplay {
  return useAppStore.getState().settings.unitDisplay ?? 'bip177'
}

function unitLabel(unit: UnitDisplay): string {
  return unit === 'sats' ? 'sats' : '₿'
}

function formatAmount(amount: number, unit: UnitDisplay): string {
  const formatted = amount.toLocaleString()
  if (unit === 'sats') {
    return `${formatted} ${amount === 1 ? 'sat' : 'sats'}`
  }
  return `₿ ${formatted}`
}

// ── Non-reactive (callbacks, services, error messages) ──

export function satUnit(): string {
  return unitLabel(getUnitDisplay())
}

export function formatSats(amount: number): string {
  return formatAmount(amount, getUnitDisplay())
}

// ── Reactive hooks (React component JSX) ──

export function useSatUnit(): string {
  const unit = useAppStore((s) => s.settings.unitDisplay ?? 'bip177')
  return unitLabel(unit)
}

export function useFormatSats(): (amount: number) => string {
  const unit = useAppStore((s) => s.settings.unitDisplay ?? 'bip177')
  return useCallback((amount: number) => formatAmount(amount, unit), [unit])
}
