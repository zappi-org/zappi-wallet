import { Check } from 'lucide-react'
import { cn } from '@/ui/lib/utils'

export interface ProgressStepperProps<T extends string> {
  steps: T[]
  currentStep: T | null
  labels: Record<T, string>
}

/**
 * Vertical progress stepper with done/current/pending states.
 * Used in AddMintScreen and TransferScreen progress views.
 */
export function ProgressStepper<T extends string>({
  steps,
  currentStep,
  labels,
}: ProgressStepperProps<T>) {
  const currentIndex = currentStep ? steps.indexOf(currentStep) : steps.length

  return (
    <div className="inline-flex flex-col space-y-3">
      {steps.map((step, i) => {
        const isDone = currentIndex > i
        const isCurrent = currentIndex === i
        return (
          <div key={step} className="flex items-center gap-2.5">
            <div className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors',
              isDone || isCurrent ? 'bg-brand' : 'bg-foreground/10'
            )}>
              {isDone ? (
                <Check className="w-4 h-4 text-white" strokeWidth={3} />
              ) : isCurrent ? (
                <div className="w-2 h-2 bg-white rounded-full" />
              ) : (
                <span className="text-overline font-bold text-foreground-muted">{i + 1}</span>
              )}
            </div>
            <span className={cn(
              'text-caption',
              isDone ? 'text-foreground-muted' : isCurrent ? 'text-foreground font-medium' : 'text-foreground-muted/50'
            )}>
              {labels[step]}
            </span>
          </div>
        )
      })}
    </div>
  )
}
