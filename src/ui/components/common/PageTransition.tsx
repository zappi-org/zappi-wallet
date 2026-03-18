import { type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'

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

/**
 * Success feedback animation variants
 */
const successVariants = {
  initial: { scale: 0 },
  animate: {
    scale: [0, 1.2, 1],
    transition: { duration: 0.5, times: [0, 0.6, 1] },
  },
}

export interface PageTransitionProps {
  children: ReactNode
  variant?: 'page' | 'modal' | 'fade'
  className?: string
}

/**
 * Wrapper component for smooth page/modal transitions
 */
export function PageTransition({
  children,
  variant = 'page',
  className = '',
}: PageTransitionProps) {
  const variants = {
    page: pageVariants,
    modal: modalVariants,
    fade: fadeVariants,
  }

  return (
    <motion.div
      data-swipe-target=""
      variants={variants[variant]}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export interface SuccessAnimationProps {
  show: boolean
  children: ReactNode
}

/**
 * Success feedback animation wrapper
 */
export function SuccessAnimation({ show, children }: SuccessAnimationProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial="initial"
          animate="animate"
          exit="exit"
          variants={successVariants}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * Animated presence wrapper for conditional rendering
 */
export interface AnimatedPresenceWrapperProps {
  show: boolean
  children: ReactNode
  variant?: 'page' | 'modal' | 'fade'
}

export function AnimatedPresenceWrapper({
  show,
  children,
  variant = 'fade',
}: AnimatedPresenceWrapperProps) {
  const variants = {
    page: pageVariants,
    modal: modalVariants,
    fade: fadeVariants,
  }

  return (
    <AnimatePresence mode="wait">
      {show && (
        <motion.div
          key="content"
          variants={variants[variant]}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
