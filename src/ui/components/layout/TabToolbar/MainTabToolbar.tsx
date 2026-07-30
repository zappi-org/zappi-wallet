import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { CameraFilled } from '@/ui/components/icons/CameraFilled'
import { hapticTap } from '@/ui/utils/haptic'
import type { NavItem } from '../nav-item'
import { WalletTabPicker } from './WalletTabPicker'
import { bottomDockClass, bottomDockInnerClass, bottomDockStyle, tabGlassClass, tweenTransition } from './styles'

export interface MainTabToolbarProps {
  navItems: NavItem[]
  activeTab: string
  onTabSelect: (id: string) => void
  onScan: () => void
}

export function MainTabToolbar({ navItems, activeTab, onTabSelect, onScan }: MainTabToolbarProps) {
  const { t } = useTranslation()

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
        {/* ---- LEFT CLUSTER (tab picker fills the dock) ---- */}
        <div className={`${tabGlassClass} flex-1`}>
          <WalletTabPicker navItems={navItems} activeTab={activeTab} onTabSelect={onTabSelect} />
        </div>

        {/* ---- RIGHT CLUSTER (standalone camera, detached from the picker group) ---- */}
        <div className={tabGlassClass}>
          <motion.button
            type="button"
            onClick={() => {
              hapticTap()
              onScan()
            }}
            whileTap={{ scale: 0.9 }}
            aria-label={t('scanner.title')}
            className="relative z-20 flex items-center justify-center w-[48px] h-[48px] rounded-full border border-transparent text-foreground/80 transform-gpu will-change-transform transition-colors"
          >
            <CameraFilled />
          </motion.button>
        </div>
      </div>
    </motion.nav>
  )
}
