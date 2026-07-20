import { type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'

export interface NavItem {
  id: string
  label: string
  icon: ReactNode
  activeIcon?: ReactNode
  badge?: number
}

export interface BottomNavProps {
  items: NavItem[]
  activeId: string
  visible: boolean
  onSelect: (id: string) => void
}

export function BottomNav({ items, activeId, visible, onSelect }: BottomNavProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.nav
          key="bottom-nav"
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed inset-x-0 bottom-0 z-50 pointer-events-none px-4"
          style={{
            paddingTop: 'var(--app-bottom-nav-top-padding)',
            paddingBottom: 'var(--app-bottom-nav-bottom-padding)',
          }}
        >
          <div className="glass-nav mx-auto w-full max-w-sm rounded-full px-1.5 py-1.5 pointer-events-auto">
            <div className="flex items-center relative">
              {items.map((item) => {
                const isActive = item.id === activeId
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className="relative flex-1 flex flex-col items-center justify-center h-[52px] z-10 transition-colors"
                  >
                    {isActive && (
                      <motion.div
                        layoutId="activeTabIndicator"
                        className="absolute inset-0 rounded-full bg-brand"
                        style={{
                          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 2px 8px rgba(81, 90, 192, 0.3)',
                        }}
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}

                    {/* Solid muted token, not a foreground alpha: text over glass
                        sits on unpredictable blurred content, so opacity-based
                        gray can drop below AA (the /35 label measured ~2.2:1). */}
                    <div className={`relative z-10 [&_svg]:w-[22px] [&_svg]:h-[22px] ${isActive ? 'text-white' : 'text-foreground-muted'}`}>
                      {isActive && item.activeIcon ? item.activeIcon : item.icon}
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="absolute -top-1 -right-2.5 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center text-[9px] font-bold bg-accent-danger text-white rounded-full leading-none">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </div>

                    <span className={`relative z-10 text-[11px] font-semibold leading-none mt-[2px] ${isActive ? 'text-white' : 'text-foreground-muted'}`}>
                      {item.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </motion.nav>
      )}
    </AnimatePresence>
  )
}
