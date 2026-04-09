import { cn } from '@/ui/lib/utils'

export interface SegmentControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  className?: string
}

export function SegmentControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: SegmentControlProps<T>) {
  const activeIndex = options.findIndex((o) => o.value === value)
  const count = options.length

  return (
    <div className={cn('relative flex p-[3px] bg-foreground/[0.06] rounded-card', className)}>
      {/* Sliding indicator */}
      <div
        className="absolute top-[3px] bottom-[3px] bg-background-card rounded-[11px] shadow-sm transition-transform duration-200 ease-out"
        style={{
          width: `calc(${100 / count}% - 3px)`,
          left: 3,
          transform: `translateX(calc(${activeIndex} * (100% + ${3 / (count - 1 || 1)}px)))`,
        }}
      />

      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'relative z-10 flex-1 min-h-[40px] py-[7px] text-caption font-semibold transition-colors duration-150',
            value === option.value ? 'text-foreground' : 'text-foreground-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
