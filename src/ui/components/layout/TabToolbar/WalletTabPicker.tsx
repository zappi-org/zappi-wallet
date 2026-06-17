import { motion } from 'motion/react'

import type { NavItem } from '../BottomNav'
import { pickerTabIds, springTransition } from './styles'

export interface WalletTabPickerProps {
  navItems: NavItem[]
  activeTab: string
  onTabSelect: (id: string) => void
}

export function WalletTabPicker({ navItems, activeTab, onTabSelect }: WalletTabPickerProps) {
  const activeIndex = pickerTabIds.findIndex((id) => id === activeTab)

  return (
    <div className="relative isolate flex items-center w-full h-[44px]">
      {activeIndex >= 0 && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-0 w-1/3 rounded-full bg-white/90 ring ring-white shadow/10 transform-gpu will-change-transform"
          style={{ backfaceVisibility: 'hidden' }}
          initial={false}
          animate={{ x: `${activeIndex * 100}%` }}
          transition={springTransition}
        />
      )}
      {pickerTabIds.map((id) => {
        const item = navItems.find((n) => n.id === id)
        if (!item) return null
        const isActive = id === activeTab
        return (
          <motion.button
            key={id}
            type="button"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onTabSelect(id)}
            whileTap={{ scale: 0.9 }}
            className={`relative z-20 flex-1 flex flex-col items-center justify-center h-[44px] rounded-full border border-transparent transform-gpu will-change-transform transition-colors ${
              isActive ? 'text-blue-500' : 'text-zinc-50 hover:text-white'
            }`}
          >
            <div className="w-[20px] h-[20px] flex items-center justify-center">
              {isActive && item.activeIcon ? item.activeIcon : item.icon}
            </div>
            <span className="text-[9.5px] font-semibold leading-none mt-0.5">{item.label}</span>
          </motion.button>
        )
      })}
    </div>
  )
}
