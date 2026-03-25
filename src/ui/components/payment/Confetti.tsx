/**
 * Confetti — Lightweight celebration particles
 * Uses CSS custom properties + animate-confetti keyframe from index.css
 */

import { useState } from 'react'

interface ConfettiProps {
  /** Number of particles */
  count?: number
  /** Colors to pick from */
  colors?: string[]
}

const DEFAULT_COLORS = [
  'var(--brand-300)',
  'var(--brand-500)',
  'var(--brand-700)',
  'var(--accent-success)',
  'var(--accent-warning)',
]

function generateParticles(count: number, colors: string[]) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.random() * 360) * (Math.PI / 180)
    const distance = 60 + Math.random() * 120
    const tx = Math.cos(angle) * distance
    const ty = Math.sin(angle) * distance - 40
    const rot = Math.random() * 720 - 360
    const size = 4 + Math.random() * 4
    const delay = Math.random() * 0.3
    const color = colors[i % colors.length]
    const isCircle = Math.random() > 0.5

    return { tx, ty, rot, size, delay, color, isCircle }
  })
}

export function Confetti({ count = 12, colors = DEFAULT_COLORS }: ConfettiProps) {
  const [particles] = useState(() => generateParticles(count, colors))

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <div className="absolute left-1/2 top-1/2">
        {particles.map((p, i) => (
          <div
            key={i}
            className="absolute animate-confetti"
            style={{
              '--tx': `${p.tx}px`,
              '--ty': `${p.ty}px`,
              '--rot': `${p.rot}deg`,
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              borderRadius: p.isCircle ? '50%' : '1px',
              animationDelay: `${p.delay}s`,
            } as React.CSSProperties}
          />
        ))}
      </div>
    </div>
  )
}
