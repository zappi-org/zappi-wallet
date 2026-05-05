/**
 * MintCardSelector — Carousel identical to HomeScreen for mint selection.
 * Scale animation, snap scroll, pagination dots, initial scroll to selected mint.
 */

import { useMemo, useEffect } from 'react'
import { MintCard, resolveMintColor } from './MintCard'
import { useWallet } from '@/ui/hooks/use-wallet'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useMintHealth } from '@/ui/hooks/use-mint-health'
import { useCarouselScroll } from '@/ui/hooks/use-carousel-scroll'
import { useAppStore } from '@/store'
import { getMintBalance } from '@/utils/url'
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
      return {
        url,
        name: getDisplayName(url),
        iconUrl: getIconUrl(url),
        balance: getMintBalance(url, balance.byMint),
        isOnline: cachedStatus?.isOnline ?? true,
        lastChecked: cachedStatus?.lastChecked,
      }
    })
    return filterFn ? all.filter(filterFn) : all
  }, [settings.mints, balance.byMint, getCachedStatus, getDisplayName, getIconUrl, filterFn])

  const { carouselRef, cardRefs, handleScroll, scrollToIndex } = useCarouselScroll({
    itemCount: mints.length,
    onIndexChange: (index) => onSelect(mints[index].url),
    scaleAnimation: true,
    fallbackGap: 12,
  })

  // Scroll to initial selected mint on mount
  useEffect(() => {
    if (mints.length === 0) return
    const idx = selectedMintUrl
      ? mints.findIndex((m) => m.url === selectedMintUrl)
      : 0
    const targetIdx = idx >= 0 ? idx : 0
    if (targetIdx > 0) {
      scrollToIndex(targetIdx)
    }
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
              {...resolveMintColor(mint.url, settings.mints.indexOf(mint.url), settings.mintColors)}
            />
          </div>
        ))}
      </div>

    </div>
  )
}
