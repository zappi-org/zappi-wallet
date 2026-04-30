import type { ReactNode } from 'react'
import { motion } from 'motion/react'

import { fadeVariants, tweenTransition } from './styles'

export interface WalletPillIconProps {
  icon?: ReactNode
  label: string
  onClick: () => void
}

export function WalletPillIcon({ icon, label, onClick }: WalletPillIconProps) {
  return (
    <motion.button
      key="wallet-pill-icon"
      variants={fadeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={tweenTransition}
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex items-center justify-center w-[48px] h-[48px] rounded-full text-foreground/80"
    >
      <div className="w-[22px] h-[22px] flex items-center justify-center">{icon}</div>
    </motion.button>
  )
}
