/**
 * MintCardSelector — Carousel identical to HomeScreen for mint selection.
 * Scale animation, snap scroll, pagination dots, initial scroll to selected mint.
 */

import { useMemo, useRef, useCallback, useEffect } from 'react'
import { MintCard, getVariantByIndex } from './MintCard'
import { useWallet } from '@/hooks/use-wallet'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { useMintHealth } from '@/hooks/use-mint-health'
import { useAppStore } from '@/store'
import type { MintInfo } from '@/core/types'

interface MintCardSelectorProps {
  selectedMintUrl: string | null
  onSelect: (url: string) => void
  filterFn?: (mint: MintInfo) => boolean
}

export function MintCardSelector({
  selectedMintUrl,
  onSelect,
  filterFn,
}: MintCardSelectorProps) {
  const { balance } = useWallet()
  const settings = useAppStore((s) => s.settings)
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)
  const { getCachedStatus } = useMintHealth()

  const mints = useMemo(() => {
    const all = settings.mints.map((url): MintInfo => {
      const cachedStatus = getCachedStatus(url)
      const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url
      return {
        url,
        name: getDisplayName(url),
        iconUrl: getIconUrl(url),
        balance: balance.byMint[normalizedUrl] || balance.byMint[url] || 0,
        isOnline: cachedStatus?.isOnline ?? true,
        lastChecked: cachedStatus?.lastChecked,
      }
    })
    return filterFn ? all.filter(filterFn) : all
  }, [settings.mints, balance.byMint, getCachedStatus, getDisplayName, getIconUrl, filterFn])

  // Carousel state — mirrors HomeScreen logic
  const carouselRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const rafRef = useRef<number>(0)

  const getCarouselGap = useCallback(() => {
    const el = carouselRef.current
    if (!el) return 12
    return parseFloat(getComputedStyle(el).columnGap) || 12
  }, [])

  const updateCardScales = useCallback(() => {
    const el = carouselRef.current
    if (!el || mints.length === 0) return
    const containerCenter = el.scrollLeft + el.clientWidth / 2
    const gap = getCarouselGap()

    cardRefs.current.forEach((card) => {
      if (!card) return
      const cardCenter = card.offsetLeft + card.offsetWidth / 2
      const distance = Math.abs(containerCenter - cardCenter)
      const maxDistance = card.offsetWidth + gap
      const progress = Math.min(distance / maxDistance, 1)
      const scale = 1 - progress * 0.08
      const opacity = 1 - progress * 0.25
      card.style.transform = `scale(${scale})`
      card.style.opacity = `${opacity}`
    })
  }, [mints.length, getCarouselGap])

  const handleScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const el = carouselRef.current
      if (!el || mints.length === 0) return
      const firstCard = cardRefs.current[0]
      const gap = getCarouselGap()
      const cardWidth = (firstCard?.offsetWidth || 300) + gap
      const index = Math.round(el.scrollLeft / cardWidth)
      const clamped = Math.max(0, Math.min(index, mints.length - 1))
      onSelect(mints[clamped].url)
      updateCardScales()
    })
  }, [mints, updateCardScales, getCarouselGap, onSelect])

  // Scroll to initial selected mint on mount
  useEffect(() => {
    const el = carouselRef.current
    if (!el || mints.length === 0) return

    const idx = selectedMintUrl
      ? mints.findIndex((m) => m.url === selectedMintUrl)
      : 0
    const targetIdx = idx >= 0 ? idx : 0

    if (targetIdx > 0) {
      const firstCard = cardRefs.current[0]
      const gap = getCarouselGap()
      const cardWidth = (firstCard?.offsetWidth || 300) + gap
      el.scrollLeft = targetIdx * cardWidth
    }

    const timer = setTimeout(updateCardScales, 50)
    return () => clearTimeout(timer)
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mints.length])

  if (mints.length === 0) return null

  return (
    <div className="relative w-full" style={{ ['--card-w' as string]: 'clamp(240px, 68vw, 310px)' }}>
      <div
        ref={carouselRef}
        onScroll={handleScroll}
        className="flex gap-3 px-[calc(50%-var(--card-w)/2)] overflow-x-auto overflow-y-visible snap-x snap-mandatory scrollbar-hide pb-2"
      >
        {mints.map((mint, idx) => (
          <div
            key={mint.url}
            ref={(el) => { cardRefs.current[idx] = el }}
            className="snap-center shrink-0 will-change-transform"
          >
            <MintCard
              mint={mint}
              variant={getVariantByIndex(idx)}
            />
          </div>
        ))}
      </div>

    </div>
  )
}
