import { useEffect, useRef } from 'react'
import { animate, motion, useAnimationFrame, useMotionValue, useReducedMotion } from 'motion/react'

export type SendJourneyStatus = 'idle' | 'pending' | 'success' | 'failure'
export type SendJourneyOutcome = Extract<SendJourneyStatus, 'success' | 'failure'>

interface SendJourneyAnimationProps {
  status: SendJourneyStatus
  className?: string
  onOutcomeComplete?: (outcome: SendJourneyOutcome) => void
}

// Percentage-like SVG coordinates. The path layer stretches to the rendered
// container while the star is positioned independently in real CSS pixels.
const ROUTE_PATH = 'M 0 56 C 20 0, 80 0, 100 56'
const PENDING_LIMIT = 0.86
const PENDING_RATE = 0.75
const DASH_FLOW_DURATION = 1.8
const ROUTE_ENDPOINT_Y = 56
const STAR_SIZE = 30

interface Point {
  x: number
  y: number
}

function cubicPoint(t: number, width: number): Point {
  const u = 1 - t
  const p0: Point = { x: 0, y: ROUTE_ENDPOINT_Y }
  const p1: Point = { x: width * 0.2, y: 0 }
  const p2: Point = { x: width * 0.8, y: 0 }
  const p3: Point = { x: width, y: ROUTE_ENDPOINT_Y }
  return {
    x: u ** 3 * p0.x + 3 * u ** 2 * t * p1.x + 3 * u * t ** 2 * p2.x + t ** 3 * p3.x,
    y: u ** 3 * p0.y + 3 * u ** 2 * t * p1.y + 3 * u * t ** 2 * p2.y + t ** 3 * p3.y,
  }
}

function cubicAngle(t: number, width: number): number {
  const u = 1 - t
  const dx = 3 * u ** 2 * width * 0.2 + 6 * u * t * width * 0.6 + 3 * t ** 2 * width * 0.2
  const dy = 3 * u ** 2 * -ROUTE_ENDPOINT_Y + 3 * t ** 2 * ROUTE_ENDPOINT_Y
  return Math.atan2(dy, dx) * (180 / Math.PI)
}

function lerpPoint(from: Point, to: Point, t: number): Point {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
  }
}

// De Casteljau split: both paths share the exact same frontier point, which is
// also mathematically identical to cubicPoint(t).
function splitRoutePaths(t: number): { completed: string; remaining: string } {
  const p0: Point = { x: 0, y: ROUTE_ENDPOINT_Y }
  const p1: Point = { x: 20, y: 0 }
  const p2: Point = { x: 80, y: 0 }
  const p3: Point = { x: 100, y: ROUTE_ENDPOINT_Y }
  const q0 = lerpPoint(p0, p1, t)
  const q1 = lerpPoint(p1, p2, t)
  const q2 = lerpPoint(p2, p3, t)
  const r0 = lerpPoint(q0, q1, t)
  const r1 = lerpPoint(q1, q2, t)
  const end = lerpPoint(r0, r1, t)

  return {
    completed: `M ${p0.x} ${p0.y} C ${q0.x} ${q0.y}, ${r0.x} ${r0.y}, ${end.x} ${end.y}`,
    remaining: `M ${end.x} ${end.y} C ${r1.x} ${r1.y}, ${q2.x} ${q2.y}, ${p3.x} ${p3.y}`,
  }
}

function ZappiStarMark() {
  return (
    <svg viewBox="80 100 340 300" className="h-full w-full" aria-hidden>
      <path
        d="M 250 120 L 280 180 L 370 150 L 330 220 L 400 290 L 320 310 L 310 380 L 260 330 L 180 380 L 190 300 L 100 280 L 160 220 L 130 140 L 210 170 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="24"
        strokeLinejoin="round"
      />
      <ellipse cx="230" cy="240" rx="9" ry="13" fill="var(--background)" />
      <ellipse cx="270" cy="240" rx="9" ry="13" fill="var(--background)" />
      <path
        d="M 236 270 Q 250 286 264 270"
        fill="none"
        stroke="var(--background)"
        strokeWidth="9"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * One continuous, indeterminate trip. While the network is pending, Zappi
 * approaches 86% asymptotically without stopping or looping. Success retargets
 * the same live progress value to the endpoint and inherits its velocity.
 */
export function SendJourneyAnimation({
  status,
  className = 'relative',
  onOutcomeComplete,
}: SendJourneyAnimationProps) {
  const reduceMotion = useReducedMotion()
  const progress = useMotionValue(0)
  const starOpacity = useMotionValue(0)
  const arrivalOpacity = useMotionValue(0)
  const arrivalScale = useMotionValue(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const remainingPathRef = useRef<SVGPathElement>(null)
  const progressPathRef = useRef<SVGPathElement>(null)
  const starRef = useRef<HTMLDivElement>(null)
  const pendingStartedAtRef = useRef<number | null>(null)
  const completionFiredRef = useRef<SendJourneyOutcome | null>(null)
  const onOutcomeCompleteRef = useRef(onOutcomeComplete)

  useEffect(() => {
    onOutcomeCompleteRef.current = onOutcomeComplete
  }, [onOutcomeComplete])

  useEffect(() => {
    const updateStarPosition = (value: number) => {
      const width = containerRef.current?.getBoundingClientRect().width || 200
      const clampedValue = Math.min(1, Math.max(0, value))
      const point = cubicPoint(clampedValue, width)
      const routeAngle = cubicAngle(clampedValue, width)
      const routePaths = splitRoutePaths(clampedValue)

      // Completed and remaining rails meet at the star but never overlap, so
      // the muted dashes cannot show through the brand-colored section.
      progressPathRef.current?.setAttribute('d', routePaths.completed)
      remainingPathRef.current?.setAttribute('d', routePaths.remaining)

      // Zappi stays mostly upright while its slight tilt follows the route.
      const angle = routeAngle * 0.22
      if (starRef.current) {
        starRef.current.style.transform = `translate3d(${point.x - STAR_SIZE / 2}px, ${point.y - STAR_SIZE / 2}px, 0) rotate(${angle}deg)`
      }
    }

    const unsubscribe = progress.on('change', updateStarPosition)
    const observer = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => updateStarPosition(progress.get()))
    if (containerRef.current) observer?.observe(containerRef.current)
    updateStarPosition(progress.get())

    return () => {
      unsubscribe()
      observer?.disconnect()
    }
  }, [progress])

  useAnimationFrame((time) => {
    if (status !== 'pending' || reduceMotion) return
    if (pendingStartedAtRef.current === null) pendingStartedAtRef.current = time
    const elapsedSeconds = (time - pendingStartedAtRef.current) / 1000
    progress.set(PENDING_LIMIT * (1 - Math.exp(-PENDING_RATE * elapsedSeconds)))
  })

  useEffect(() => {
    if (status === 'idle') {
      pendingStartedAtRef.current = null
      completionFiredRef.current = null
      progress.set(0)
      starOpacity.set(0)
      arrivalOpacity.set(0)
      arrivalScale.set(1)
      return
    }

    if (status === 'pending') {
      pendingStartedAtRef.current = null
      completionFiredRef.current = null
      progress.set(reduceMotion ? 0.5 : 0)
      starOpacity.set(1)
      arrivalOpacity.set(0)
      arrivalScale.set(1)
      return
    }

    if (completionFiredRef.current === status) return
    let cancelled = false

    const complete = () => {
      if (cancelled || completionFiredRef.current === status) return
      completionFiredRef.current = status
      onOutcomeCompleteRef.current?.(status)
    }

    if (status === 'failure') {
      const fade = animate(starOpacity, 0, {
        duration: reduceMotion ? 0.1 : 0.2,
        ease: [0.7, 0, 0.84, 0],
      })
      fade.then(complete)
      return () => {
        cancelled = true
        fade.stop()
      }
    }

    if (reduceMotion) {
      progress.set(1)
      starOpacity.set(0)
      const timer = window.setTimeout(complete, 100)
      return () => {
        cancelled = true
        window.clearTimeout(timer)
      }
    }

    const remaining = Math.max(0, 1 - progress.get())
    const arrivalDuration = Math.min(0.68, Math.max(0.3, 0.28 + remaining * 0.44))
    const flight = animate(progress, 1, {
      type: 'spring',
      bounce: 0,
      duration: arrivalDuration,
      velocity: Math.max(0, progress.getVelocity()),
    })

    flight.then(() => {
      if (cancelled) return
      starOpacity.set(0)
      const glow = animate(arrivalOpacity, [0, 0.42, 0], {
        duration: 0.24,
        times: [0, 0.4, 1],
        ease: 'easeOut',
      })
      const bloom = animate(arrivalScale, [1, 1.9, 1], {
        duration: 0.24,
        times: [0, 0.45, 1],
        ease: [0.16, 1, 0.3, 1],
      })
      Promise.all([glow, bloom]).then(complete)
    })

    return () => {
      cancelled = true
      flight.stop()
    }
  }, [status, reduceMotion, progress, starOpacity, arrivalOpacity, arrivalScale])

  return (
    <div ref={containerRef} className={className} aria-hidden data-journey-status={status}>
      {/* Only the rails are hard-clipped at mint-right → destination-left. */}
      <div data-testid="send-journey-track" className="absolute inset-0 overflow-hidden">
        <svg
          viewBox="0 0 100 80"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-hidden"
        >
          <motion.path
            ref={remainingPathRef}
            data-testid="send-journey-remaining"
            d={ROUTE_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeDasharray="5 7"
            vectorEffect="non-scaling-stroke"
            className="text-foreground-muted/40"
            animate={
              !reduceMotion
                ? { strokeDashoffset: [0, -24] }
                : { strokeDashoffset: 0 }
            }
            transition={
              !reduceMotion
                ? { duration: DASH_FLOW_DURATION, ease: 'linear', repeat: Infinity }
                : { duration: 0.15 }
            }
          />

          <path
            ref={progressPathRef}
            data-testid="send-journey-progress"
            d={splitRoutePaths(0).completed}
            fill="none"
            stroke="var(--brand)"
            strokeWidth="2.4"
            strokeLinecap="butt"
            vectorEffect="non-scaling-stroke"
            opacity={status === 'idle' ? 0 : 0.56}
          />
        </svg>
      </div>

      {/* The traveler sits outside the rectangular rail clip. */}
      <motion.div
        ref={starRef}
        data-testid="send-journey-star"
        className="pointer-events-none absolute left-0 top-0 z-[5] h-[30px] w-[30px] text-brand drop-shadow-[0_4px_6px_color-mix(in_srgb,var(--brand)_26%,transparent)]"
        style={{ opacity: starOpacity }}
      >
        <ZappiStarMark />
      </motion.div>

      {/* The route ends at the destination icon's left edge. The success glow
          is offset 14px to the icon's actual center, behind the DOM endpoint. */}
      <div className="pointer-events-none absolute left-[calc(100%+14px)] top-[56px] -translate-x-1/2 -translate-y-1/2">
        <motion.span
          className="block h-5 w-5 rounded-full bg-brand"
          style={{ opacity: arrivalOpacity, scale: arrivalScale }}
        />
      </div>
    </div>
  )
}
