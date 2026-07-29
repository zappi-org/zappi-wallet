import { useId } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/ui/lib/utils'

export interface SegmentControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  className?: string
  /**
   * 'quiet' — smaller label, fainter rail, flat pill. For screens where the
   * control is a filter over secondary content and must not out-weigh the
   * thing above it (the send destination input).
   */
  tone?: 'default' | 'quiet'
}

// Single segmented-tab control for the whole app: Radix supplies the tab
// semantics (roles, roving focus), the shared-layout pill supplies the slide.
export function SegmentControl<T extends string>({
  value,
  onChange,
  options,
  className,
  tone = 'default',
}: SegmentControlProps<T>) {
  // Scopes the pill's layoutId so multiple controls on screen never swap pills.
  const layoutGroupId = useId()
  const reduceMotion = useReducedMotion()
  const quiet = tone === 'quiet'

  return (
    <TabsPrimitive.Root value={value} onValueChange={(v) => onChange(v as T)} className={className}>
      {/* Default h-13 leaves each trigger a full 44px tap target (p-1 rail).
          'quiet' trades 8px of that for a smaller object, because there it is a
          filter sitting under the thing that actually matters. */}
      <TabsPrimitive.List
        className={cn(
          'flex w-full p-1 rounded-2xl',
          quiet ? 'h-11 bg-foreground/[0.035]' : 'h-13 bg-foreground/[0.06]',
        )}
      >
        <LayoutGroup id={layoutGroupId}>
          {options.map((option) => (
            <TabsPrimitive.Trigger
              key={option.value}
              value={option.value}
              className={cn(
                'relative flex-1 flex items-center justify-center rounded-xl transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                quiet ? 'text-caption font-medium' : 'text-subtitle font-semibold',
                value === option.value ? 'text-foreground' : 'text-foreground-muted',
              )}
            >
              {value === option.value && (
                <motion.span
                  layoutId="segment-pill"
                  className={cn('absolute inset-0 bg-background-card rounded-xl', !quiet && 'shadow-sm')}
                  transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: 'easeOut' }}
                />
              )}
              <span className="relative z-10">{option.label}</span>
            </TabsPrimitive.Trigger>
          ))}
        </LayoutGroup>
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  )
}
