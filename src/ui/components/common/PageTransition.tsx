import { type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { fadeTransition } from '@/ui/utils/motion'

/**
 * Page transition animation variants (Section 17.6)
 */
const pageVariants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
}

/**
 * Modal animation variants
 */
const modalVariants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
}

/**
 * Fade animation variants
 */
const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

export interface PageTransitionProps {
  children: ReactNode
  variant?: 'page' | 'modal' | 'fade'
  className?: string
}

/**
 * Wrapper component for smooth page/modal transitions
 */
export function PageTransition({ children, variant = 'page', className = '' }: PageTransitionProps) {
  const reduceMotion = useReducedMotion()
  const variants = {
    page: pageVariants,
    modal: modalVariants,
    fade: fadeVariants,
  }

  return (
    <motion.div
      variants={reduceMotion ? fadeVariants : variants[variant]}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={fadeTransition(reduceMotion, 0.2)}
      className={className}
    >
      {children}
    </motion.div>
  )
}
