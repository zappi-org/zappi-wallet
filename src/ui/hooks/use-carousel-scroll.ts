import { useRef, useCallback, useEffect } from 'react'

interface UseCarouselScrollOptions {
  /** Number of items in the carousel */
  itemCount: number
  /** Called when the active index changes via scroll */
  onIndexChange: (index: number) => void
  /** Whether to apply scale/opacity animation to cards (default: false) */
  scaleAnimation?: boolean
  /** Fallback gap when CSS gap cannot be read */
  fallbackGap?: number
}

interface UseCarouselScrollReturn {
  carouselRef: React.RefObject<HTMLDivElement | null>
  cardRefs: React.MutableRefObject<(HTMLDivElement | null)[]>
  handleScroll: () => void
  /** Manually trigger scale update (e.g. after mount) */
  updateScales: () => void
  /** Scroll to a specific index (instant) */
  scrollToIndex: (index: number) => void
}

/**
 * Shared carousel scroll hook — used by HomeScreen, MintSelectBottomSheet.
 * Handles RAF-based scroll tracking, snap index calculation, and optional scale animation.
 */
export function useCarouselScroll({
  itemCount,
  onIndexChange,
  scaleAnimation = false,
  fallbackGap = 12,
}: UseCarouselScrollOptions): UseCarouselScrollReturn {
  const carouselRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const rafRef = useRef<number>(0)
  const cachedGapRef = useRef<number | null>(null)

  // Cleanup RAF on unmount
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const getGap = useCallback(() => {
    if (cachedGapRef.current !== null) return cachedGapRef.current
    const el = carouselRef.current
    if (!el) return fallbackGap
    const gap = parseFloat(getComputedStyle(el).columnGap || getComputedStyle(el).gap) || fallbackGap
    cachedGapRef.current = gap
    return gap
  }, [fallbackGap])

  const updateScales = useCallback(() => {
    if (!scaleAnimation) return
    const el = carouselRef.current
    if (!el || itemCount === 0) return
    const containerCenter = el.scrollLeft + el.clientWidth / 2
    const gap = getGap()

    cardRefs.current.forEach((card) => {
      if (!card) return
      const cardCenter = card.offsetLeft + card.offsetWidth / 2
      const distance = Math.abs(containerCenter - cardCenter)
      const maxDistance = card.offsetWidth + gap
      const progress = Math.min(distance / maxDistance, 1)
      const scale = 1 - progress * 0.12
      const opacity = 1 - progress * 0.35
      card.style.transform = `scale(${scale})`
      card.style.opacity = `${opacity}`
    })
  }, [scaleAnimation, itemCount, getGap])

  const handleScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const el = carouselRef.current
      if (!el || itemCount === 0) return
      const firstCard = cardRefs.current[0] || el.children[0] as HTMLElement | undefined
      if (!firstCard) return
      const gap = getGap()
      const cardWidth = firstCard.offsetWidth + gap
      const index = Math.round(el.scrollLeft / cardWidth)
      const clamped = Math.max(0, Math.min(index, itemCount - 1))
      onIndexChange(clamped)
      if (scaleAnimation) updateScales()
    })
  }, [itemCount, onIndexChange, scaleAnimation, updateScales, getGap])

  const scrollToIndex = useCallback((index: number) => {
    const el = carouselRef.current
    if (!el) return
    const firstCard = cardRefs.current[0] || el.children[0] as HTMLElement | undefined
    if (!firstCard) return
    const gap = getGap()
    const cardWidth = firstCard.offsetWidth + gap
    el.scrollLeft = index * cardWidth
  }, [getGap])

  // Initial scale setup after mount/items change
  useEffect(() => {
    if (!scaleAnimation) return
    const timer = setTimeout(updateScales, 50)
    return () => clearTimeout(timer)
  }, [itemCount, scaleAnimation, updateScales])

  return {
    carouselRef,
    cardRefs,
    handleScroll,
    updateScales,
    scrollToIndex,
  }
}
