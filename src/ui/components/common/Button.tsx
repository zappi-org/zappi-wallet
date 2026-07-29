import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/ui/lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline' | 'brand'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: ReactNode
  children?: ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: 'bg-accent-primary text-white hover:bg-accent-primary/90',
  // Tinted, not white-on-white: this variant carries 취소 / 초기화 and has to
  // read as a button on the canvas AND inside white sheets. 6% is the tint the
  // segment rail already uses, so it is the system's own value, not a new one.
  secondary: 'bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.09]',
  destructive: 'bg-accent-danger text-white hover:bg-accent-danger/90',
  ghost: 'bg-transparent text-foreground-muted hover:bg-background-card',
  outline: 'border border-input bg-background hover:bg-background-card',
  brand: 'bg-brand text-white rounded-card shadow-lg shadow-brand/25 hover:bg-brand/90',
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-label font-medium rounded-card',
  md: 'h-9 px-4 text-caption rounded-card',
  lg: 'h-12 px-5 text-body rounded-card',
  xl: 'h-14 px-6 text-subtitle font-semibold rounded-card',
}

// Touch feedback styles (Section 17.3)
const touchFeedbackStyles = 'active:scale-[0.98] active:opacity-80 transition-all duration-100'

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      disabled,
      icon,
      children,
      className = '',
      ...props
    },
    ref
  ) => {
    const isDisabled = disabled || loading

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        // Merged, not concatenated: a caller's class has to be able to beat the
        // variant/size defaults (CSS order, not class order, decides otherwise).
        // shrink-0 goes last because it is a layout invariant of the button, not
        // a default — a caller's flex-1 must not strip it.
        className={cn(
          'inline-flex items-center justify-center font-medium whitespace-nowrap',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:pointer-events-none',
          // A dedicated disabled skin, not 50% opacity: half-opacity brand still
          // composites to a saturated, shadowed bar that reads as tappable.
          // A loading button is busy, not unavailable — it keeps its own skin
          // and lets the spinner carry the state.
          // Fainter than the secondary tint (6%) on purpose — otherwise a
          // disabled secondary would be indistinguishable from an enabled one.
          !loading && 'disabled:bg-foreground/[0.035] disabled:text-foreground-subtle disabled:border-transparent disabled:shadow-none',
          loading && 'disabled:opacity-80',
          variantStyles[variant],
          sizeStyles[size],
          touchFeedbackStyles,
          className,
          'shrink-0',
        )}
        {...props}
      >
        {loading ? (
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : icon ? (
          <span className="mr-2">{icon}</span>
        ) : null}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
