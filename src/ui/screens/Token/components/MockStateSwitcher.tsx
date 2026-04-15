import type { TokenViewState } from '../types'

export interface MockStateSwitcherProps {
  value: TokenViewState
  onChange: (value: TokenViewState) => void
}

const STATES: { value: TokenViewState; label: string }[] = [
  { value: 'empty', label: 'empty' },
  { value: 'active', label: 'active' },
  { value: 'first-create', label: 'first-create' },
]

export function MockStateSwitcher({ value, onChange }: MockStateSwitcherProps) {
  if (!import.meta.env.DEV) return null

  return (
    <div className="sticky top-2 z-10 mx-auto flex w-fit items-center gap-1 rounded-full border border-border bg-background-card/90 p-1 shadow-sm backdrop-blur">
      {STATES.map((s) => (
        <button
          key={s.value}
          type="button"
          onClick={() => onChange(s.value)}
          className={`px-3 py-1 rounded-full text-label transition-colors ${
            value === s.value
              ? 'bg-accent-primary text-white'
              : 'text-foreground-muted hover:text-foreground'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
