import { type HTMLAttributes } from 'react'

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'circular' | 'text'
}

/**
 * Skeleton loading placeholder (Section 17.5)
 */
export function Skeleton({ className = '', variant = 'default', ...props }: SkeletonProps) {
  const variantStyles = {
    default: 'rounded-lg',
    circular: 'rounded-full',
    text: 'rounded',
  }

  return (
    <div
      className={`
        bg-foreground-subtle/20
        animate-pulse
        ${variantStyles[variant]}
        ${className}
      `.trim()}
      {...props}
    />
  )
}

/**
 * Balance display skeleton
 */
export function BalanceSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-4 w-20" />
    </div>
  )
}

/**
 * Transaction list item skeleton
 */
export function TransactionSkeleton() {
  return (
    <div className="flex items-center gap-3 p-4">
      <Skeleton className="h-10 w-10" variant="circular" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-4 w-16" />
    </div>
  )
}

/**
 * Transaction list skeleton
 */
export function TransactionListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <TransactionSkeleton key={i} />
      ))}
    </div>
  )
}

/**
 * Settings item skeleton
 */
export function SettingsItemSkeleton() {
  return (
    <div className="flex items-center justify-between p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-6 w-6" variant="circular" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-4 w-4" />
    </div>
  )
}
