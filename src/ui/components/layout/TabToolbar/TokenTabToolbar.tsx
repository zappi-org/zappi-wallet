import { type RefObject } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'

import type { NavItem } from '../BottomNav'
import { useScrollHysteresis } from '@/ui/hooks/use-scroll-hysteresis'
import { useTokenTabToolbarState } from '@/ui/hooks/use-token-tab-toolbar-state'
import { CreateRegisterPair } from './CreateRegisterPair'
import { EcashPill } from './EcashPill'
import { WalletPillIcon } from './WalletPillIcon'
import { fadeVariants, tabGlassClass, tweenTransition } from './styles'

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
  const { state, triggerReexpand } = useTokenTabToolbarState({
    isTokenTab: activeTab === 'token',
    collapsed,
    scrollRef,
  })

  const tokenItem = navItems.find((n) => n.id === 'token')
  const walletItem = navItems.find((n) => n.id === 'wallet')

  const handleLeftWalletTap = () => onTabSelect('wallet')

  const handleRightTokenTap = () => {
    triggerReexpand()
  }

  return (
    <motion.nav
      key="token-tab-toolbar"
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={tweenTransition}
      className="fixed z-50 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm flex items-center justify-between gap-2 pointer-events-auto"
      style={{ bottom: 'var(--app-bottom-nav-bottom)' }}
    >
      {/* ---- LEFT CLUSTER ---- */}
      <motion.div
        layout
        transition={tweenTransition}
        className={tabGlassClass}
      >
        <WalletPillIcon
          icon={walletItem?.icon}
          label={t('nav.wallet')}
          onClick={handleLeftWalletTap}
        />
      </motion.div>

      {/* ---- RIGHT CLUSTER ---- */}
      <AnimatePresence mode="popLayout" initial={false}>
        {state === 'TOKEN_TOP' ? (
          <motion.div
            key="create-register-pair"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={tweenTransition}
          >
            <CreateRegisterPair onCreate={onCreate} onRegister={onRegister} />
          </motion.div>
        ) : (
          <motion.div
            key="token-pill"
            variants={fadeVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={tweenTransition}
          >
            <EcashPill
              icon={tokenItem?.icon}
              activeIcon={tokenItem?.activeIcon}
              active
              label={tokenItem?.label ?? t('nav.token')}
              onClick={handleRightTokenTap}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
