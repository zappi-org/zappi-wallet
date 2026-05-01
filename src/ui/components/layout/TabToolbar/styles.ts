import type { CSSProperties } from 'react'

export const glassStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.06)',
  backdropFilter: 'blur(28px) saturate(200%)',
  WebkitBackdropFilter: 'blur(28px) saturate(200%)',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  boxShadow:
    '0 8px 32px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.03), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
}

export const brandStyle: CSSProperties = {
  background: 'var(--brand-500)',
  boxShadow: '0 8px 24px rgba(81, 90, 192, 0.3), 0 2px 8px rgba(0, 0, 0, 0.12)',
}

export const tweenTransition = { duration: 0.2, ease: 'easeOut' } as const

export const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

export const pickerTabIds = ['wallet', 'contacts', 'settings'] as const
