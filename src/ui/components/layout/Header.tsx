import type { ReactNode } from 'react'

export interface HeaderProps {
  title?: string
  leftAction?: ReactNode
  rightAction?: ReactNode
  children?: ReactNode
  showBorder?: boolean
}

export function Header({
  title,
  leftAction,
  rightAction,
  children,
  showBorder = true,
}: HeaderProps) {
  return (
    <header
      className={`
        sticky top-0 z-10 relative
        flex items-center justify-between px-3 py-2 bg-background
        ${showBorder ? 'border-b border-border' : ''}
      `}
    >
      {/* Left Section */}
      <div className="flex items-center gap-2 min-w-[40px] z-10">
        {leftAction}
      </div>

      {/* Center Section - always absolutely centered */}
      {title ? (
        <h1 className="absolute inset-0 flex items-center justify-center px-16 text-center text-heading font-bold text-foreground pointer-events-none truncate">
          {title}
        </h1>
      ) : children ? (
        <div className="flex-1 flex items-center justify-center">
          {children}
        </div>
      ) : null}

      {/* Right Section */}
      <div className="flex items-center gap-2 min-w-[40px] justify-end z-10">
        {rightAction}
      </div>
    </header>
  )
}

export interface IconButtonProps {
  icon: ReactNode
  onClick: () => void
  label: string
  disabled?: boolean
}

export function IconButton({ icon, onClick, label, disabled }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-muted transition-colors disabled:opacity-50"
    >
      {icon}
    </button>
  )
}
