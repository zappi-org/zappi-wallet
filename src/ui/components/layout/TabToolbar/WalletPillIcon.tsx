import type { ReactNode } from 'react'
import { motion } from 'motion/react'

export interface WalletPillIconProps {
  icon?: ReactNode
  label: string
  onClick: () => void
}

export function WalletPillIcon({ icon, label, onClick }: WalletPillIconProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      whileTap={{ scale: 0.9 }}
      className="relative z-20 flex items-center justify-center w-[48px] h-[48px] rounded-full border border-transparent text-foreground/80 transform-gpu will-change-transform transition-colors"
    >
      <div className="w-[22px] h-[22px] flex items-center justify-center [&_svg]:w-[22px] [&_svg]:h-[22px]">{icon}</div>
    </motion.button>
  )
}
