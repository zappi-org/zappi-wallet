import type { CSSProperties } from 'react'

export const tabGlassClass =
  'pointer-events-auto isolate relative transform-gpu will-change-transform overflow-hidden rounded-full ring-2 ring-white/10 bg-zinc-950/30 backdrop-blur-xl p-1 shadow-lg'

export const brandStyle: CSSProperties = {
  background: 'var(--brand-500)',
  boxShadow: '0 8px 24px rgba(81, 90, 192, 0.3), 0 2px 8px rgba(0, 0, 0, 0.12)',
}

export const tweenTransition = { duration: 0.2, ease: 'easeOut' } as const

export const springTransition = { type: 'spring', stiffness: 300, damping: 20, mass: 0.4 } as const

export const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

export const pickerTabIds = ['wallet', 'contacts', 'settings'] as const
