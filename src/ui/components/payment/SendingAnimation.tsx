/**
 * Sending Animation — 3D Orbital
 * Center: BTC sphere, orbiting Lightning (clockwise) and eCash (counter-clockwise) satellites
 * CSS 3D perspective creates tilted orbital plane for depth effect
 * showCheck: overlay a checkmark on center (used by SendCompleteStep)
 */

import { motion } from 'motion/react'
import { Check } from 'lucide-react'

interface SendingAnimationProps {
  className?: string
  /** Show checkmark overlay on center BTC (completion state) */
  showCheck?: boolean
  /** Scale factor (default 1). Use 1.4 for full-screen usage */
  scale?: number
}

// Orbit configuration
const ORBIT_RADIUS = 90
const ORBIT_TILT = 65 // degrees — how much the orbital plane is tilted
const ORBIT_DURATION = 5 // seconds per revolution
const CENTER_SIZE = 120
const SATELLITE_SIZE = 36

export function SendingAnimation({ className = '', showCheck = false, scale = 1 }: SendingAnimationProps) {
  const size = Math.round(240 * scale)
  return (
    <div className={`relative ${className}`} style={{ width: size, height: size, transform: `scale(${scale})`, transformOrigin: 'center' }}>
      {/* Elliptical shadow under the whole thing for 3D grounding */}
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-2"
        style={{
          width: 180,
          height: 24,
          background: 'radial-gradient(ellipse, rgba(0,0,0,0.08) 0%, transparent 70%)',
        }}
      />

      {/* 3D Orbital Plane (tilted via perspective) */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ perspective: '800px' }}
      >
        <div
          className="relative"
          style={{
            width: ORBIT_RADIUS * 2,
            height: ORBIT_RADIUS * 2,
            transformStyle: 'preserve-3d',
            transform: `rotateX(${ORBIT_TILT}deg)`,
          }}
        >
          {/* Orbit ring — appears as an ellipse due to tilt */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              border: '1.5px solid rgba(0,0,0,0.06)',
            }}
          />

          {/* Lightning satellite — clockwise */}
          <motion.div
            className="absolute"
            style={{
              width: SATELLITE_SIZE,
              height: SATELLITE_SIZE,
              top: '50%',
              left: '50%',
              marginTop: -SATELLITE_SIZE / 2,
              marginLeft: -SATELLITE_SIZE / 2,
            }}
            animate={{ rotate: 360 }}
            transition={{ duration: ORBIT_DURATION, repeat: Infinity, ease: 'linear' }}
          >
            <div
              style={{
                width: SATELLITE_SIZE,
                height: SATELLITE_SIZE,
                transform: `translateX(${ORBIT_RADIUS}px) rotateX(-${ORBIT_TILT}deg)`,
              }}
            >
              <div className="w-full h-full rounded-full bg-[#8B5CF6] flex items-center justify-center shadow-md">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
            </div>
          </motion.div>

          {/* eCash satellite — counter-clockwise, 180° phase offset */}
          <motion.div
            className="absolute"
            style={{
              width: SATELLITE_SIZE,
              height: SATELLITE_SIZE,
              top: '50%',
              left: '50%',
              marginTop: -SATELLITE_SIZE / 2,
              marginLeft: -SATELLITE_SIZE / 2,
              rotate: 180,
            }}
            animate={{ rotate: -180 }}
            transition={{ duration: ORBIT_DURATION, repeat: Infinity, ease: 'linear' }}
          >
            <div
              style={{
                width: SATELLITE_SIZE,
                height: SATELLITE_SIZE,
                transform: `translateX(${ORBIT_RADIUS}px) rotateX(-${ORBIT_TILT}deg)`,
              }}
            >
              <div className="w-full h-full rounded-full bg-[#10B981] flex items-center justify-center shadow-md">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="8" stroke="white" strokeWidth="2" />
                  <path d="M12 8v8M9 11h6" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* BTC Center sphere — outside orbital plane, always faces viewer */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          {/* Subtle glow pulse */}
          <motion.div
            className="absolute -inset-3 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(0,0,0,0.04) 0%, transparent 70%)' }}
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.2, 0.5] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />

          {/* Main sphere */}
          <div
            className="rounded-full flex items-center justify-center"
            style={{
              width: CENTER_SIZE,
              height: CENTER_SIZE,
              background: 'linear-gradient(180deg, #f0f0f0 0%, #d8d8d8 100%)',
              boxShadow: 'inset 0 2px 8px rgba(255,255,255,0.6), inset 0 -4px 8px rgba(0,0,0,0.08), 0 4px 16px rgba(0,0,0,0.1)',
            }}
          >
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
              <path
                d="M15.3 11.2c.2-1.4-.9-2.2-2.3-2.7l.5-2-1.2-.3-.5 1.9c-.3-.1-.6-.2-1-.3l.5-1.9-1.2-.3-.5 2c-.3-.1-.5-.1-.8-.2l-1.6-.4-.3 1.3s.9.2.9.2c.5.1.6.4.6.7l-.6 2.4c0 0 .1 0 .1 0l-.1 0-.8 3.3c-.1.2-.2.4-.6.3 0 0-.9-.2-.9-.2l-.6 1.4 1.5.4c.3.1.6.1.8.2l-.5 2 1.2.3.5-2c.3.1.7.2 1 .3l-.5 2 1.2.3.5-2c2.1.4 3.6.2 4.3-1.7.5-1.5 0-2.3-1.1-2.9.8-.2 1.4-.7 1.5-1.8zM13.6 14c-.4 1.5-2.8.7-3.6.5l.6-2.6c.8.2 3.3.6 3 2.1zm.4-3c-.3 1.4-2.4.7-3 .5l.6-2.3c.7.2 2.8.5 2.4 1.8z"
                fill="#F7931A"
              />
            </svg>
          </div>

          {/* Check overlay (completion state) */}
          {showCheck && (
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
            >
              <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                <Check className="w-7 h-7 text-[#10B981]" strokeWidth={3} />
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
