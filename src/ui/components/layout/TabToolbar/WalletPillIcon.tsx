import type { ReactNode } from 'react'

export interface WalletPillIconProps {
  icon?: ReactNode
  label: string
  onClick: () => void
}

export function WalletPillIcon({ icon, label, onClick }: WalletPillIconProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex items-center justify-center w-[48px] h-[48px] rounded-full text-foreground/80"
    >
      <div className="w-[22px] h-[22px] flex items-center justify-center">{icon}</div>
    </button>
  )
}
