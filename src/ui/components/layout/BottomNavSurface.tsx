import { type ReactNode } from 'react'
import { motion } from 'motion/react'

interface BottomNavSurfaceProps {
  children: ReactNode
  className?: string
  debugId?: string
}

const surfaceStyle = {
  background: 'linear-gradient(180deg, rgba(248, 249, 252, 0) 0%, rgba(248, 249, 252, 0.92) 26%, var(--background) 100%)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
} as const

export function BottomNavSurface({ children, className, debugId }: BottomNavSurfaceProps) {
  return (
    <motion.div
      data-viewport-debug={debugId}
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pointer-events-none ${className ?? ''}`}
      style={surfaceStyle}
    >
      {children}
    </motion.div>
  )
}
