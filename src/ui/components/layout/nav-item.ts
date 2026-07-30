import type { ReactNode } from 'react'

/** One tab entry for the toolbar docks (main/token pickers). */
export interface NavItem {
  id: string
  label: string
  icon: ReactNode
  activeIcon?: ReactNode
  badge?: number
}
