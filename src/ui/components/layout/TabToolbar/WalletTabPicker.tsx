import type { NavItem } from '../BottomNav'
import { pickerTabIds } from './styles'

export interface WalletTabPickerProps {
  navItems: NavItem[]
  activeTab: string
  onTabSelect: (id: string) => void
}

export function WalletTabPicker({ navItems, activeTab, onTabSelect }: WalletTabPickerProps) {
  return (
    <div className="flex items-center gap-1 w-full h-[48px]">
      {pickerTabIds.map((id) => {
        const item = navItems.find((n) => n.id === id)
        if (!item) return null
        const isActive = id === activeTab
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTabSelect(id)}
            className={`flex-1 flex flex-col items-center justify-center h-[48px] rounded-full transition-colors ${
              isActive ? 'text-white bg-brand' : 'text-foreground/60'
            }`}
          >
            <div className="w-[20px] h-[20px] flex items-center justify-center">
              {isActive && item.activeIcon ? item.activeIcon : item.icon}
            </div>
            <span className="text-[10px] font-semibold leading-none mt-[1px]">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
