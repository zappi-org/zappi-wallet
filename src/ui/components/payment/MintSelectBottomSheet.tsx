import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, AnimatePresence } from 'motion/react'
import { hapticTap } from '@/utils/haptic'
import { useAppStore } from '@/store'
import { useWallet } from '@/hooks/use-wallet'
import { useMintHealth } from '@/hooks/use-mint-health'
import { useMintMetadata } from '@/hooks/use-mint-metadata'
import { MintCard, getVariantByIndex } from '@/ui/components/wallet/MintCard'
import { Button } from '@/ui/components/common/Button'
import type { MintInfo } from '@/core/types'

export interface MintSelectBottomSheetProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (mintUrl: string) => void
  selectedMintUrl: string | null
  /** Filter function to control which mints are shown (e.g. only mints with balance) */
  filterFn?: (mint: MintInfo) => boolean
  /** Custom button label */
  buttonLabel?: string
  /** Additional info text below cards (e.g. estimated fee) */
  infoText?: string
}

/**
 * Wrapper: Inner unmounts when isOpen=false, remounts fresh when isOpen=true.
 * This naturally resets local state without effect-based setState.
 */
export function MintSelectBottomSheet({
  isOpen,
  ...rest
}: MintSelectBottomSheetProps) {
  return (
    <AnimatePresence>
      {isOpen && <MintSelectBottomSheetInner {...rest} />}
    </AnimatePresence>
  )
}

/** Inner component — remounted each time sheet opens so local state resets naturally */
function MintSelectBottomSheetInner({
  selectedMintUrl,
  onClose,
  onSelect,
  filterFn,
  buttonLabel,
  infoText,
}: Omit<MintSelectBottomSheetProps, 'isOpen'>) {
  const { t } = useTranslation()
  const { balance } = useWallet()
  const settings = useAppStore((state) => state.settings)
  const { getCachedStatus } = useMintHealth()
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)

  const [localSelected, setLocalSelected] = useState<string | null>(selectedMintUrl)
  const carouselRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef(0)
  const cachedGapRef = useRef<number | null>(null)

  // Cleanup RAF on unmount
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  // Build mint list
  const mints: MintInfo[] = settings.mints.map((url: string) => ({
    url,
    name: getDisplayName(url),
    balance: balance.byMint[url] || 0,
    isOnline: getCachedStatus(url)?.isOnline !== false,
    iconUrl: getIconUrl(url),
  }))

  const filteredMints = filterFn ? mints.filter(filterFn) : mints

  // Scroll to selected card on mount
  useEffect(() => {
    if (localSelected && carouselRef.current) {
      const idx = filteredMints.findIndex((m) => m.url === localSelected)
      if (idx > 0) {
        requestAnimationFrame(() => {
          const el = carouselRef.current
          if (!el) return
          const card = el.children[idx] as HTMLElement | undefined
          if (card) {
            el.scrollTo({
              left: card.offsetLeft - el.clientWidth / 2 + card.clientWidth / 2,
              behavior: 'instant',
            })
          }
        })
      }
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Track closest card on every scroll frame (like HomeScreen carousel)
  const handleScroll = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      const el = carouselRef.current
      if (!el || filteredMints.length === 0) return
      const scrollLeft = el.scrollLeft
      const firstCard = el.children[0] as HTMLElement | undefined
      if (!firstCard) return
      const gap = cachedGapRef.current ?? (cachedGapRef.current = parseFloat(getComputedStyle(el).gap) || 12)
      const cardWidth = firstCard.offsetWidth + gap
      const index = Math.round(scrollLeft / cardWidth)
      const clampedIndex = Math.max(0, Math.min(index, filteredMints.length - 1))
      const mint = filteredMints[clampedIndex]
      if (mint) {
        setLocalSelected(mint.url)
      }
    })
  }, [filteredMints])

  const handleConfirm = useCallback(() => {
    if (localSelected) {
      hapticTap()
      onSelect(localSelected)
      onClose()
    }
  }, [localSelected, onSelect, onClose])

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.5 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black z-[60]"
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={t('payment.selectMint')}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="fixed bottom-0 left-0 right-0 bg-[#fffdf6] border-t border-[rgba(133,133,133,0.23)] rounded-t-[20px] z-[70] pb-safe"
      >
        {/* Handle */}
        <div className="flex justify-center py-2">
          <div className="w-8 h-1 bg-foreground-subtle rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-center px-4 pb-3">
          <h3 className="font-semibold text-lg text-foreground">
            {t('payment.selectMint')}
          </h3>
        </div>

        {/* Card Carousel */}
        <div
          ref={carouselRef}
          onScroll={handleScroll}
          className="flex gap-3 px-[calc(50%-var(--card-w)/2)] overflow-x-auto snap-x snap-mandatory scrollbar-hide py-2"
        >
          {filteredMints.map((mint, idx) => (
            <div
              key={mint.url}
              className="snap-center shrink-0"
            >
              <MintCard
                mint={mint}
                variant={getVariantByIndex(idx)}
                isSelected={localSelected === mint.url}
                onClick={() => {
                  hapticTap()
                  setLocalSelected(mint.url)
                }}
              />
            </div>
          ))}
        </div>

        {/* Pagination Dots */}
        {filteredMints.length > 1 && (
          <div className="flex justify-center gap-2 mt-2">
            {filteredMints.map((mint, idx) => (
              <div
                key={idx}
                className={`w-1.5 h-1.5 rounded-full ${
                  localSelected === mint.url ? 'bg-[#1d1d1f]' : 'bg-[#d9d9d9]'
                }`}
              />
            ))}
          </div>
        )}

        {/* Info text (e.g. estimated fee) */}
        {infoText && (
          <p className="text-center text-sm text-foreground-muted mt-2 px-6">
            {infoText}
          </p>
        )}

        {/* Confirm Button */}
        <div className="px-5 pt-4 pb-4">
          <Button
            variant="primary"
            size="xl"
            disabled={!localSelected}
            onClick={handleConfirm}
            className="w-full !bg-[#3b7df5] !text-white !rounded-xl !h-14 !text-lg"
          >
            {buttonLabel || t('payment.selectThisMint')}
          </Button>
        </div>
      </motion.div>
    </>
  )
}
