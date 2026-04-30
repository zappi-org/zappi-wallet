import { cn } from '@/ui/primitives/utils'

export interface CSCategoryOption<T extends string> {
  value: T
  label: string
}

interface CSCategoryPillsProps<T extends string> {
  options: CSCategoryOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
  disabled?: boolean
}

export function CSCategoryPills<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
}: CSCategoryPillsProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-full px-3.5 py-2 text-[12px] tracking-[-0.005em] transition-colors disabled:opacity-50',
              selected
                ? 'bg-brand-50 text-brand border border-brand font-semibold'
                : 'bg-background-card text-brand-900 border border-border font-medium',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
