import { useMemo } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import zappiLogo from '@/assets/zappi.png'
import cashuNut from '@/assets/cashu-nut.png'

export interface EasterEggScreenProps {
  onClose: () => void
  /** Number of raining logo instances. */
  count?: number
}

interface Drop {
  id: number
  kind: 'zappi' | 'nut'
  leftPct: number
  size: number
  duration: number
  delay: number
  rotateStart: number
  rotateEnd: number
  startOffsetPct: number
}

function createDrops(count: number): Drop[] {
  let s = (Date.now() & 0xffffffff) | 0
  const rand = () => {
    s = (s * 1664525 + 1013904223) | 0
    return ((s >>> 0) % 10000) / 10000
  }
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    kind: rand() < 0.5 ? 'zappi' : 'nut',
    leftPct: rand() * 100,
    size: 48 + Math.floor(rand() * 72), // 48–120 px
    duration: 2.6 + rand() * 2.4,       // 2.6–5.0 s
    delay: rand() * 2.8,                // 0–2.8 s stagger
    rotateStart: Math.floor(rand() * 360) - 180,
    rotateEnd: Math.floor(rand() * 1440) - 720,
    startOffsetPct: -20 - rand() * 60,  // -20% to -80% above viewport
  }))
}

/**
 * Full-page easter egg — Zappi stars + Cashu nuts raining while rotating.
 * Entered after 10 taps on the raw-token box inside TokenRawSheet.
 */
export function EasterEggScreen({ onClose, count = 28 }: EasterEggScreenProps) {
  const { t } = useTranslation()
  const drops = useMemo(() => createDrops(count), [count])

  return (
    <div
      className="relative h-full overflow-hidden"
      style={{ backgroundColor: '#C598E5' }}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        className="absolute right-[35px] z-10 w-9 h-9 -m-2 p-2 flex items-center justify-center rounded-lg text-foreground hover:bg-black/[0.06] active:bg-black/[0.1] transition-colors"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }}
      >
        <X className="w-6 h-6" strokeWidth={1.6} />
      </button>

      {drops.map((d) => (
        <motion.img
          key={d.id}
          src={d.kind === 'zappi' ? zappiLogo : cashuNut}
          alt=""
          draggable={false}
          initial={{
            top: `${d.startOffsetPct}%`,
            rotate: d.rotateStart,
            opacity: 0,
          }}
          animate={{
            top: '120%',
            rotate: d.rotateEnd,
            opacity: [0, 1, 1, 0.95],
          }}
          transition={{
            duration: d.duration,
            delay: d.delay,
            repeat: Infinity,
            ease: 'linear',
            opacity: {
              duration: d.duration,
              delay: d.delay,
              times: [0, 0.1, 0.9, 1],
              repeat: Infinity,
            },
          }}
          className="pointer-events-none absolute select-none"
          style={{
            left: `${d.leftPct}%`,
            width: d.size,
            height: d.size,
            transform: 'translateX(-50%)',
            imageRendering: d.kind === 'nut' ? 'pixelated' : 'auto',
          }}
        />
      ))}

      <div className="absolute inset-x-0 bottom-[30%] flex justify-center pointer-events-none">
        <p
          className="text-[18px] font-bold text-foreground text-center px-8"
          style={{ letterSpacing: '0.15em' }}
        >
          {t('token.detail.raw.easterEgg')}
        </p>
      </div>
    </div>
  )
}

export default EasterEggScreen
