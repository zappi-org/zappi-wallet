import type { CSSProperties } from 'react'

export const bottomDockClass =
  'fixed inset-x-0 bottom-0 z-50 pointer-events-none px-4'

export const bottomDockInnerClass =
  'mx-auto flex w-full max-w-sm items-center justify-between gap-2 pointer-events-auto'

export const bottomDockStyle: CSSProperties = {
  paddingTop: 'var(--app-bottom-nav-top-padding)',
  // No env() here: iOS standalone flip-flops the bottom inset between
  // relaunch paths, which made the dock jump ~34px across reloads.
  paddingBottom: 'var(--app-bottom-nav-bottom-padding)',
}

export const tabGlassClass =
  'pointer-events-auto isolate relative transform-gpu will-change-transform overflow-hidden rounded-full bg-white/[0.06] backdrop-blur-[28px] backdrop-saturate-200 p-1 ring-1 ring-white/[0.15] shadow-[0_2px_10px_rgba(0,0,0,0.04),inset_0_1px_0_rgba(255,255,255,0.1)]'

export const tweenTransition = { duration: 0.2, ease: 'easeOut' } as const

export const springTransition = { type: 'spring', stiffness: 300, damping: 20, mass: 0.4 } as const

export const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

export const pickerTabIds = ['wallet', 'contacts', 'settings'] as const
