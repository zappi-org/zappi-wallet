import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { BanknotesIcon } from '@heroicons/react/24/outline'

import { tabGlassClass } from './styles'

export interface EcashPillProps {
  icon?: ReactNode
  activeIcon?: ReactNode
  active?: boolean
  label: string
  onClick: () => void
}

export function EcashPill({ icon, activeIcon, active = false, label, onClick }: EcashPillProps) {
  return (
    <div className={tabGlassClass}>
      <motion.button
        type="button"
        onClick={onClick}
        whileTap={{ scale: 0.9 }}
        className="relative z-20 flex flex-col items-center justify-center px-4 h-[48px] rounded-full border border-transparent text-foreground/80 transform-gpu will-change-transform transition-colors"
      >
        <div className="w-[22px] h-[22px] flex items-center justify-center [&_svg]:w-[22px] [&_svg]:h-[22px]">
          {active && activeIcon ? activeIcon : icon ?? <BanknotesIcon className="w-[22px] h-[22px]" />}
        </div>
        <span className="text-[11px] font-semibold leading-none mt-[2px]">{label}</span>
      </motion.button>
    </div>
  )
}
