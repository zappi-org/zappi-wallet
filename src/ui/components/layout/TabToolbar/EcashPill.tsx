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
        className="relative z-20 flex flex-col items-center justify-center px-4 h-[44px] rounded-full border border-transparent text-zinc-50 hover:text-white transform-gpu will-change-transform transition-colors"
      >
        <div className="w-[20px] h-[20px] flex items-center justify-center">
          {active && activeIcon ? activeIcon : icon ?? <BanknotesIcon className="w-[20px] h-[20px]" />}
        </div>
        <span className="text-[9.5px] font-semibold leading-none mt-0.5">{label}</span>
      </motion.button>
    </div>
  )
}
