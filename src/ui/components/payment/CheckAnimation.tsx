/**
 * Check Animation
 * SVG circle draws, then checkmark strokes in, followed by a subtle scale bounce
 * Used in SendCompleteStep
 */

import { motion } from 'motion/react'

interface CheckAnimationProps {
  className?: string
  /** Circle + check color */
  color?: string
  /** Overall size in px */
  size?: number
}

export function CheckAnimation({
  className = '',
  color = '#10B981',
  size = 96,
}: CheckAnimationProps) {
  const strokeWidth = 3
  const radius = 38
  const circumference = 2 * Math.PI * radius

  return (
    <motion.div
      className={`flex items-center justify-center ${className}`}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: [0.8, 1.1, 1], opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut', times: [0, 0.6, 1] }}
    >
      <svg width={size} height={size} viewBox="0 0 80 80" fill="none">
        {/* Background circle (subtle) */}
        <circle
          cx="40"
          cy="40"
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          opacity={0.15}
        />

        {/* Animated circle stroke */}
        <motion.circle
          cx="40"
          cy="40"
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          initial={{ strokeDasharray: circumference, strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          // Start from top (rotate -90deg)
          transform="rotate(-90 40 40)"
        />

        {/* Animated checkmark */}
        <motion.path
          d="M25 41L35 51L55 31"
          stroke={color}
          strokeWidth={strokeWidth + 0.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.35, delay: 0.45, ease: 'easeOut' }}
        />
      </svg>
    </motion.div>
  )
}
