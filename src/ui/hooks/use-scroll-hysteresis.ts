import { useEffect, useState, type RefObject } from 'react'

/**
 * Tracks whether a scroll container has crossed a collapse threshold,
 * with hysteresis to avoid flicker at the boundary.
 */
export function useScrollHysteresis(
  ref: RefObject<HTMLElement | null>,
  collapseAt = 24,
  expandAt = 16,
): boolean {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onScroll = () => {
      const y = el.scrollTop
      setCollapsed((prev) => {
        if (!prev && y > collapseAt) return true
        if (prev && y < expandAt) return false
        return prev
      })
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [ref, collapseAt, expandAt])

  return collapsed
}
