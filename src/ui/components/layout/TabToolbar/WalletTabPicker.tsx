import { motion } from 'motion/react'

import { isExternalNavigation } from '@/ui/navigation/navigation-store'
import type { NavItem } from '../nav-item'
import { pickerTabIds, springTransition } from './styles'

export interface WalletTabPickerProps {
  navItems: NavItem[]
  activeTab: string
  onTabSelect: (id: string) => void
}

export function WalletTabPicker({ navItems, activeTab, onTabSelect }: WalletTabPickerProps) {
  const activeIndex = pickerTabIds.findIndex((id) => id === activeTab)

  return (
    <div className="relative isolate flex items-center w-full h-[48px]">
      {activeIndex >= 0 && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-0 w-1/3 rounded-full bg-brand transform-gpu will-change-transform"
          style={{ backfaceVisibility: 'hidden' }}
          initial={false}
          animate={{ x: `${activeIndex * 100}%` }}
          // The nav-chrome counterpart of the screen jump-cut: a tab change without a live
          // app-initiated mark arrives with screens that already snapped (external pop, or a
          // non-animated app navigation), so the indicator snaps with them instead of sliding
          // late. Pure read — the destructive consume lives in ScreenActivity alone.
          transition={isExternalNavigation() ? { duration: 0 } : springTransition}
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
            // Re-tapping the active tab is a no-op — don't remount the screen.
            onClick={() => { if (!isActive) onTabSelect(id) }}
            whileTap={{ scale: 0.9 }}
            className={`relative z-20 flex-1 flex flex-col items-center justify-center h-[48px] rounded-full border border-transparent transform-gpu will-change-transform transition-colors ${
              isActive ? 'text-white' : 'text-foreground/60'
            }`}
          >
            <div className="w-[22px] h-[22px] flex items-center justify-center [&_svg]:w-[22px] [&_svg]:h-[22px]">
              {isActive && item.activeIcon ? item.activeIcon : item.icon}
            </div>
            <span className="text-[11px] font-semibold leading-none mt-[2px]">{item.label}</span>
          </motion.button>
        )
      })}
    </div>
  )
}
