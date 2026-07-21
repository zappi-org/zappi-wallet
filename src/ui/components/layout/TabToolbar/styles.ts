import type { CSSProperties } from 'react'

export const bottomDockClass =
  'fixed inset-x-0 bottom-0 z-50 pointer-events-none px-4'

export const bottomDockInnerClass =
  'mx-auto flex w-full max-w-sm items-center justify-between gap-2 pointer-events-auto'

export const bottomDockStyle: CSSProperties = {
  paddingTop: 'var(--app-bottom-nav-top-padding)',
  // On device the dock keeps a slim 0.5rem gap above the home indicator (the
  // pre-ca5434c cover-mode value); stacking the full base gap on the inset
  // opens an oversized band. Desktop (inset 0) keeps the 1rem base.
  paddingBottom: 'max(var(--app-bottom-nav-bottom-padding), calc(var(--safe-area-inset-bottom) + 0.5rem))',
}

export const tabGlassClass =
  'pointer-events-auto isolate relative transform-gpu will-change-transform overflow-hidden rounded-full bg-white/[0.06] backdrop-blur-[28px] backdrop-saturate-200 p-1 ring-1 ring-white/[0.15] shadow-[0_2px_10px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.1)]'

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
