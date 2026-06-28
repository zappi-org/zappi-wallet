import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import type { NavItem } from '../BottomNav'
import { EcashPill } from './EcashPill'
import { WalletTabPicker } from './WalletTabPicker'
import { bottomDockClass, bottomDockInnerClass, bottomDockStyle, tabGlassClass, tweenTransition } from './styles'

export interface MainTabToolbarProps {
  navItems: NavItem[]
  activeTab: string
  onTabSelect: (id: string) => void
}

export function MainTabToolbar({ navItems, activeTab, onTabSelect }: MainTabToolbarProps) {
  const { t } = useTranslation()
  const tokenItem = navItems.find((n) => n.id === 'token')

  const handleEcashTap = () => onTabSelect('token')

  return (
    <motion.nav
      key="main-tab-toolbar"
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={tweenTransition}
      className={bottomDockClass}
      style={bottomDockStyle}
    >
      <div className={bottomDockInnerClass}>
        {/* ---- LEFT CLUSTER (always expanded picker) ---- */}
        <div className={`${tabGlassClass} w-[65%]`}>
          <WalletTabPicker navItems={navItems} activeTab={activeTab} onTabSelect={onTabSelect} />
        </div>

        {/* ---- RIGHT CLUSTER (always ecash pill) ---- */}
        <EcashPill
          icon={tokenItem?.icon}
          activeIcon={tokenItem?.activeIcon}
          label={tokenItem?.label ?? t('nav.token')}
          onClick={handleEcashTap}
        />
      </div>
    </motion.nav>
  )
}
