import { Plus } from 'lucide-react'

interface CSFABProps {
  label: string
  onClick: () => void
  ariaLabel?: string
}

export function CSFAB({ label, onClick, ariaLabel }: CSFABProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className="fixed right-5 z-[70] h-12 pl-4 pr-5 rounded-full bg-brand text-white flex items-center gap-1.5 text-[14px] font-semibold tracking-[-0.005em] active:scale-[0.98] transition-transform"
      style={{
        bottom: 'calc(28px + env(safe-area-inset-bottom, 0px))',
        boxShadow:
          '0 8px 22px -4px rgba(81,90,192,0.55), 0 2px 4px rgba(15,23,42,0.08)',
      }}
    >
      <Plus className="w-4 h-4" strokeWidth={2} />
      {label}
    </button>
  )
}
