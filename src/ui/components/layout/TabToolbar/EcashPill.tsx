import type { ReactNode } from 'react'
import { Coins } from 'lucide-react'

import { glassStyle } from './styles'

export interface EcashPillProps {
  icon?: ReactNode
  label: string
  onClick: () => void
}

export function EcashPill({ icon, label, onClick }: EcashPillProps) {
  return (
    <div className="rounded-full overflow-hidden p-1.5" style={glassStyle}>
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col items-center justify-center px-4 h-[48px] rounded-full text-foreground/80"
      >
        <div className="w-[22px] h-[22px] flex items-center justify-center">
          {icon ?? <Coins className="w-[22px] h-[22px]" strokeWidth={1.6} />}
        </div>
        <span className="text-[10px] font-semibold leading-none mt-[1px]">{label}</span>
      </button>
    </div>
  )
}
