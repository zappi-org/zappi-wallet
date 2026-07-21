/**
 * DirectionalTabPanel — direction-aware slide+fade for tab-switched content.
 *
 * Content slides in from the side of the newly selected tab (right when moving
 * to a higher tab index, left when moving lower) so the motion matches the
 * spatial order of the tab bar. `custom` forwards the CURRENT direction to the
 * exiting child too — without it, AnimatePresence would replay the exit with
 * the direction latched at the previous render.
 */
import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

const SLIDE_OFFSET_PX = 24

const variants = {
  enter: (dir: number) => ({ x: dir * SLIDE_OFFSET_PX, opacity: dir === 0 ? 1 : 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: -dir * SLIDE_OFFSET_PX, opacity: dir === 0 ? 1 : 0 }),
}

export interface DirectionalTabPanelProps {
  /** Identity of the active tab — a key change triggers the swap animation. */
  tabKey: string
  /** Position of the active tab in the tab bar; drives slide direction. */
  tabIndex: number
  className?: string
  children: ReactNode
}

export function DirectionalTabPanel({ tabKey, tabIndex, className, children }: DirectionalTabPanelProps) {
  const reduceMotion = useReducedMotion()
  // Adjust-state-during-render: the slide direction must be known in the same
  // render that swaps the keyed child, or the first frame animates the wrong way.
  const [prevIndex, setPrevIndex] = useState(tabIndex)
  const [slideDir, setSlideDir] = useState(1)
  if (tabIndex !== prevIndex) {
    setSlideDir(tabIndex > prevIndex ? 1 : -1)
    setPrevIndex(tabIndex)
  }
  // dir 0 collapses the variants to an instant swap (no offset, no fade).
  const dir = reduceMotion ? 0 : slideDir

  return (
    <AnimatePresence mode="popLayout" initial={false} custom={dir}>
      <motion.div
        key={tabKey}
        custom={dir}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
