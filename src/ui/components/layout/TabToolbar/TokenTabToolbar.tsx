import { type RefObject } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'

import type { NavItem } from '../BottomNav'
import { useScrollHysteresis } from '@/ui/hooks/use-scroll-hysteresis'
import { useTokenTabToolbarState } from '@/ui/hooks/use-token-tab-toolbar-state'
import { CreateRegisterPair } from './CreateRegisterPair'
import { EcashPill } from './EcashPill'
import { WalletPillIcon } from './WalletPillIcon'
import { WalletTabPicker } from './WalletTabPicker'
import { glassStyle, tweenTransition } from './styles'

export interface TokenTabToolbarProps {
  navItems: NavItem[]
  activeTab: string
  scrollRef: RefObject<HTMLElement | null>
  onTabSelect: (id: string) => void
  onCreate: () => void
  onRegister: () => void
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
  const { state, setWalletMenuOpen, triggerReexpand } = useTokenTabToolbarState({
    isTokenTab: activeTab === 'token',
    collapsed,
    scrollRef,
  })

  const tokenItem = navItems.find((n) => n.id === 'token')
  const walletItem = navItems.find((n) => n.id === 'wallet')

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
      key="token-tab-toolbar"
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={tweenTransition}
      className="fixed z-50 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm flex items-center justify-between gap-2 pointer-events-auto"
      style={{ bottom: 'var(--app-bottom-nav-offset)' }}
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
            <WalletPillIcon
              icon={walletItem?.icon}
              label={t('nav.wallet')}
              onClick={handleLeftWalletTap}
            />
          ) : (
            <WalletTabPicker
              navItems={navItems}
              activeTab={activeTab}
              onTabSelect={handleTabTapInPicker}
            />
          )}
        </AnimatePresence>
      </motion.div>

      {/* ---- RIGHT CLUSTER ---- */}
      <AnimatePresence mode="popLayout" initial={false}>
        {state === 'TOKEN_TOP' ? (
          <CreateRegisterPair onCreate={onCreate} onRegister={onRegister} />
        ) : (
          <EcashPill
            icon={tokenItem?.icon}
            label={tokenItem?.label ?? t('nav.token')}
            onClick={handleRightTokenTap}
          />
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
