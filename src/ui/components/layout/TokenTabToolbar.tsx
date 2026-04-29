import { type CSSProperties, type RefObject } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Coins } from 'lucide-react'

import type { NavItem } from './BottomNav'
import { useScrollHysteresis } from '@/ui/hooks/use-scroll-hysteresis'
import { useTokenTabToolbarState } from '@/ui/hooks/use-token-tab-toolbar-state'

export interface TokenTabToolbarProps {
  navItems: NavItem[]
  activeTab: string
  scrollRef: RefObject<HTMLElement | null>
  onTabSelect: (id: string) => void
  onCreate: () => void
  onRegister: () => void
}

const glassStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.06)',
  backdropFilter: 'blur(28px) saturate(200%)',
  WebkitBackdropFilter: 'blur(28px) saturate(200%)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
}

const brandStyle: CSSProperties = {
  background: 'var(--brand-500)',
  boxShadow: '0 8px 24px rgba(81, 90, 192, 0.3), 0 2px 8px rgba(0, 0, 0, 0.12)',
}

const pickerTabIds = ['wallet', 'contacts', 'settings'] as const

const tweenTransition = { duration: 0.2, ease: 'easeOut' } as const

const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

export function TokenTabToolbar({
  navItems,
  activeTab,
  scrollRef,
  onTabSelect,
  onCreate,
  onRegister,
}: TokenTabToolbarProps) {
  const { t } = useTranslation()
  const collapsed = useScrollHysteresis(scrollRef, 24, 16)
  const { state, setWalletMenuOpen, triggerReexpand } =
    useTokenTabToolbarState({ isTokenTab: activeTab === 'token', collapsed, scrollRef })

  const tokenItem = navItems.find((n) => n.id === 'token')

  const handleLeftWalletTap = () => setWalletMenuOpen(true)

  const handleRightTokenTap = () => {
    setWalletMenuOpen(false)
    triggerReexpand()
  }

  const handleTabTapInPicker = (id: string) => {
    setWalletMenuOpen(false)
    if (id === 'token') return
    onTabSelect(id)
  }

  return (
    <motion.nav
      data-viewport-debug="token-toolbar"
      key="token-tab-toolbar"
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={tweenTransition}
      className="fixed z-50 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm flex items-center justify-between gap-2 pointer-events-auto"
      style={{ bottom: 0 }}
    >
      {/* ---- LEFT CLUSTER ---- */}
      <motion.div
        layout
        transition={tweenTransition}
        className={`rounded-full overflow-hidden p-1.5 ${
          state === 'TOKEN_NAV_OPEN' ? 'w-[65%]' : ''
        }`}
        style={glassStyle}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {state !== 'TOKEN_NAV_OPEN' ? (
            <motion.button
              key="wallet-pill-icon"
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={tweenTransition}
              type="button"
              onClick={handleLeftWalletTap}
              aria-label={t('nav.wallet')}
              className="flex items-center justify-center w-[48px] h-[48px] rounded-full text-foreground/80"
            >
              <div className="w-[22px] h-[22px] flex items-center justify-center">
                {navItems.find((n) => n.id === 'wallet')?.icon}
              </div>
            </motion.button>
          ) : (
            <motion.div
              key="tab-picker"
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={tweenTransition}
              className="flex items-center gap-1 w-full h-[48px]"
            >
              {pickerTabIds.map((id) => {
                const item = navItems.find((n) => n.id === id)
                if (!item) return null
                const isActive = id === activeTab
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleTabTapInPicker(id)}
                    className={`flex-1 flex flex-col items-center justify-center h-[48px] rounded-full transition-colors ${
                      isActive ? 'text-white bg-brand' : 'text-foreground/60'
                    }`}
                  >
                    <div className="w-[20px] h-[20px] flex items-center justify-center">
                      {isActive && item.activeIcon ? item.activeIcon : item.icon}
                    </div>
                    <span className="text-[10px] font-semibold leading-none mt-[1px]">
                      {item.label}
                    </span>
                  </button>
                )
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ---- RIGHT CLUSTER ---- */}
      <motion.div
        layout
        transition={tweenTransition}
        className={`rounded-full overflow-hidden p-1.5 ${
          state === 'TOKEN_TOP' ? 'w-[50%]' : ''
        }`}
        style={state === 'TOKEN_TOP' ? brandStyle : glassStyle}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {state === 'TOKEN_TOP' ? (
            <motion.div
              key="create-register"
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={tweenTransition}
              className="flex items-center gap-1 w-full h-[48px]"
            >
              <button
                type="button"
                onClick={onCreate}
                className="flex-1 h-[48px] rounded-full bg-white text-brand text-sm font-semibold"
              >
                {t('token.create')}
              </button>
              <button
                type="button"
                onClick={onRegister}
                className="flex-1 h-[48px] rounded-full text-white text-sm font-semibold"
              >
                {t('token.register')}
              </button>
            </motion.div>
          ) : (
            <motion.button
              key="token-pill"
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={tweenTransition}
              type="button"
              onClick={handleRightTokenTap}
              className="flex flex-col items-center justify-center px-4 h-[48px] rounded-full text-foreground/80"
            >
              <div className="w-[22px] h-[22px] flex items-center justify-center">
                {tokenItem?.icon ?? <Coins className="w-[22px] h-[22px]" strokeWidth={1.6} />}
              </div>
              <span className="text-[10px] font-semibold leading-none mt-[1px]">
                {tokenItem?.label ?? t('nav.token')}
              </span>
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.nav>
  )
}
