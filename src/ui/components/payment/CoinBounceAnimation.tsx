/**
 * Coin Bounce Animation
 * 3 gold coins drop from above with spring physics bounce
 * Used in ReceiveCompleteStep
 */

import { motion } from 'motion/react'
import { useSatUnit } from '@/utils/format'

interface CoinBounceAnimationProps {
  className?: string
}

const coins = [
  { size: 56, x: -40, delay: 0 },
  { size: 72, x: 0, delay: 0.1 },
  { size: 48, x: 44, delay: 0.2 },
]

function CoinSVG({ size, unit }: { size: number; unit: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <defs>
        <linearGradient id="coinGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F7D774" />
          <stop offset="100%" stopColor="#E5A53D" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="url(#coinGrad)" stroke="#D4942A" strokeWidth="2" />
      <circle cx="24" cy="24" r="16" fill="none" stroke="#D4942A" strokeWidth="1" opacity="0.4" />
      {/* BTC symbol */}
      <text
        x="24"
        y="30"
        textAnchor="middle"
        fontSize="18"
        fontWeight="bold"
        fill="#8B6914"
        fontFamily="system-ui"
      >
        {unit}
      </text>
    </svg>
  )
}

export function CoinBounceAnimation({ className = '' }: CoinBounceAnimationProps) {
  const unit = useSatUnit()
  return (
    <div className={`relative w-48 h-40 mx-auto ${className}`}>
      {coins.map((coin, i) => (
        <motion.div
          key={i}
          className="absolute"
          style={{
            left: '50%',
            marginLeft: -(coin.size / 2) + coin.x,
            bottom: 0,
          }}
          initial={{ y: -200, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 12,
            delay: coin.delay,
          }}
        >
          <CoinSVG size={coin.size} unit={unit} />
        </motion.div>
      ))}
    </div>
  )
}
