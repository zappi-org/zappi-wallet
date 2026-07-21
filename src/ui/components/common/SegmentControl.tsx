import { useId } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/ui/lib/utils'

export interface SegmentControlProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  className?: string
}

// Single segmented-tab control for the whole app: Radix supplies the tab
// semantics (roles, roving focus), the shared-layout pill supplies the slide.
export function SegmentControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: SegmentControlProps<T>) {
  // Scopes the pill's layoutId so multiple controls on screen never swap pills.
  const layoutGroupId = useId()
  const reduceMotion = useReducedMotion()

  return (
    <TabsPrimitive.Root value={value} onValueChange={(v) => onChange(v as T)} className={className}>
      <TabsPrimitive.List className="flex h-11 w-full p-1 bg-foreground/[0.06] rounded-2xl">
        <LayoutGroup id={layoutGroupId}>
          {options.map((option) => (
            <TabsPrimitive.Trigger
              key={option.value}
              value={option.value}
              className={cn(
                'relative flex-1 flex items-center justify-center text-subtitle font-semibold transition-colors duration-150',
                value === option.value ? 'text-foreground' : 'text-foreground-muted',
              )}
            >
              {value === option.value && (
                <motion.span
                  layoutId="segment-pill"
                  className="absolute inset-0 bg-background-card rounded-xl shadow-sm"
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
