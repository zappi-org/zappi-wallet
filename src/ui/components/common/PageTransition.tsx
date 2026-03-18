import { type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'

/**
 * Page transition animation variants (Section 17.6)
 */
/**
 * Variant functions accept a `custom` boolean (passed from AnimatePresence).
 * When custom=true (swipe-back transition), exit animation is suppressed
 * to prevent the exiting screen from flashing over the new screen.
 */
const pageVariants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: (skipExit: boolean) => skipExit
    ? { opacity: 0, transition: { duration: 0 } }
    : { opacity: 0, x: -20 },
}

const modalVariants = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: (skipExit: boolean) => skipExit
    ? { opacity: 0, transition: { duration: 0 } }
    : { opacity: 0, scale: 0.95 },
}

const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: (skipExit: boolean) => skipExit
    ? { opacity: 0, transition: { duration: 0 } }
    : { opacity: 0 },
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
  /** Skip the enter animation (used by swipe-back to avoid double-animation) */
  skipInitial?: boolean
}

/**
 * Wrapper component for smooth page/modal transitions
 */
export function PageTransition({
  children,
  variant = 'page',
  className = '',
  skipInitial = false,
}: PageTransitionProps) {
  const variants = {
    page: pageVariants,
    modal: modalVariants,
    fade: fadeVariants,
  }

  return (
    <motion.div
      variants={variants[variant]}
      initial={skipInitial ? false : 'initial'}
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
