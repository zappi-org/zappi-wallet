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
          <div
            className="mx-auto w-full max-w-sm rounded-full px-1.5 py-1.5 pointer-events-auto"
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              backdropFilter: 'blur(28px) saturate(200%)',
              WebkitBackdropFilter: 'blur(28px) saturate(200%)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              boxShadow: '0 2px 10px rgba(0, 0, 0, 0.04), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
            }}
          >
            <div className="flex items-center relative">
              {items.map((item) => {
                const isActive = item.id === activeId
                return (
                  <button
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className="relative flex-1 flex flex-col items-center justify-center h-[48px] z-10 transition-colors"
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

                    <div className={`relative z-10 ${isActive ? 'text-white' : 'text-foreground/35'}`}>
                      {isActive && item.activeIcon ? item.activeIcon : item.icon}
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="absolute -top-1 -right-2.5 min-w-[14px] h-[14px] px-0.5 flex items-center justify-center text-[9px] font-bold bg-accent-danger text-white rounded-full leading-none">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      )}
                    </div>

                    <span className={`relative z-10 text-[10px] font-semibold leading-none mt-[1px] ${isActive ? 'text-white' : 'text-foreground/35'}`}>
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
