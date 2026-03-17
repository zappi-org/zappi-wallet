import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

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
  secondary: 'bg-background-card text-foreground hover:bg-background-card/80',
  destructive: 'bg-accent-danger text-white hover:bg-accent-danger/90',
  ghost: 'bg-transparent text-foreground-muted hover:bg-background-card',
  outline: 'border border-input bg-background hover:bg-background-card',
  brand: 'bg-brand text-white rounded-[14px] shadow-lg shadow-brand/25 hover:bg-brand/90',
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 px-2 text-xs rounded-md',
  md: 'h-8 px-3 text-sm rounded-lg',
  lg: 'h-10 px-4 text-base rounded-lg',
  xl: 'h-14 px-6 text-lg rounded-[14px]',
}

// Touch feedback styles (Section 17.3)
const touchFeedbackStyles = 'active:scale-95 active:opacity-80 transition-all duration-100'

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
        className={`
          inline-flex items-center justify-center font-medium whitespace-nowrap shrink-0
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
          disabled:pointer-events-none disabled:opacity-50
          ${variantStyles[variant]}
          ${sizeStyles[size]}
          ${touchFeedbackStyles}
          ${className}
        `.trim()}
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
