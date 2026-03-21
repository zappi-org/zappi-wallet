import type { ReactNode } from 'react'

export interface NavItem {
  id: string
  label: string
  icon: ReactNode
  badge?: number
}

export interface BottomNavProps {
  items: NavItem[]
  activeId: string
  onSelect: (id: string) => void
}

export function BottomNav({ items, activeId, onSelect }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background border-t border-border pb-safe z-50">
      <div className="flex items-center justify-around">
        {items.map((item) => {
          const isActive = item.id === activeId
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`
                flex-1 flex flex-col items-center gap-1 py-2.5 px-2
                transition-all active:scale-95 active:opacity-80
                ${isActive ? 'text-primary' : 'text-muted-foreground'}
              `}
            >
              <div className="relative">
                {item.icon}
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1 -right-2 min-w-[16px] h-[16px] px-1 flex items-center justify-center text-overline font-bold bg-destructive text-primary-foreground rounded-full">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className="text-label">{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
