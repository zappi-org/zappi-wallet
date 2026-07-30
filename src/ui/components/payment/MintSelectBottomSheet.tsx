import { useState, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { hapticTap } from '@/ui/utils/haptic'
import { useAppStore } from '@/store'
import { getMintBalance } from '@/utils/url'
import { useWallet } from '@/ui/hooks/use-wallet'
import { useMintHealth } from '@/ui/hooks/use-mint-health'
import { useMintMetadata } from '@/ui/hooks/use-mint-metadata'
import { useCarouselScroll } from '@/ui/hooks/use-carousel-scroll'
import { useKeyboardInset } from '@/ui/hooks/use-keyboard-inset'
import { MintCard, resolveMintColor } from '@/ui/components/wallet/MintCard'
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
  /** Allow selecting mints with zero balance (e.g. for receive flows) */
  allowEmpty?: boolean
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
  allowEmpty,
}: Omit<MintSelectBottomSheetProps, 'isOpen'>) {
  const { t } = useTranslation()
  const { balance } = useWallet()
  const settings = useAppStore((state) => state.settings)
  const { getCachedStatus } = useMintHealth()
  const { getDisplayName, getIconUrl } = useMintMetadata(settings.mints)
  // Lift the sheet above the soft keyboard: this sheet opens from flows where a
  // text input may still be focused (npub needs-mint-selection, ContactsScreen),
  // and bottom:0 alone leaves it behind the keyboard on iOS (viewport-only resize).
  const keyboardInset = useKeyboardInset()

  // Build mint list (memoized to avoid rebuild on carousel scroll)
  const mints: MintInfo[] = useMemo(() =>
    settings.mints.map((url: string) => ({
      url,
      name: getDisplayName(url),
      balance: getMintBalance(url, balance.byMint),
      isOnline: getCachedStatus(url)?.isOnline !== false,
      iconUrl: getIconUrl(url),
    })),
    [settings.mints, getDisplayName, balance.byMint, getCachedStatus, getIconUrl]
  )

  const filteredMints = useMemo(() =>
    filterFn ? mints.filter(filterFn) : mints,
    [mints, filterFn]
  )

  const [localSelected, setLocalSelected] = useState<string | null>(
    selectedMintUrl || filteredMints[0]?.url || null
  )

  const { carouselRef, handleScroll, scrollToIndex } = useCarouselScroll({
    itemCount: filteredMints.length,
    onIndexChange: (index) => {
      const mint = filteredMints[index]
      if (mint) setLocalSelected(mint.url)
    },
    fallbackGap: 12,
  })

  // Scroll to selected card on mount
  useEffect(() => {
    if (localSelected) {
      const idx = filteredMints.findIndex((m) => m.url === localSelected)
      if (idx > 0) {
        requestAnimationFrame(() => scrollToIndex(idx))
      }
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedMint = filteredMints.find((m) => m.url === localSelected)
  const selectedHasBalance = (selectedMint?.balance ?? 0) > 0

  const handleConfirm = useCallback(() => {
    if (localSelected && (allowEmpty || selectedHasBalance)) {
      hapticTap()
      onSelect(localSelected)
      onClose()
    }
  }, [localSelected, allowEmpty, selectedHasBalance, onSelect, onClose])

  // Portaled: inside a transformed Stackflow activity, `fixed` is trapped in
  // the activity's stacking context, so the root-level tab dock (z-50) paints
  // over the sheet on tab screens. body-level rendering restores true stacking.
  return createPortal(
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
        // transition-[bottom] eases the keyboard-inset ride (motion only
        // animates the y transform, so bottom would otherwise snap).
        className="fixed left-0 right-0 bg-background-card border-t border-border rounded-t-[20px] z-[70] transition-[bottom] duration-200 ease-out motion-reduce:transition-none"
        style={{ bottom: keyboardInset }}
      >
        {/* Handle */}
        <div className="flex justify-center py-2">
          <div className="w-10 h-1 bg-foreground-subtle rounded-full" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-center px-4 pb-3">
          <h3 className="text-subtitle font-semibold text-foreground">
            {t('payment.selectMint')}
          </h3>
        </div>

        {/* Card Carousel */}
        <div
          ref={carouselRef}
          onScroll={handleScroll}
          className="flex gap-2 px-[calc(50%-var(--card-w)/2)] overflow-x-auto snap-x snap-mandatory scrollbar-hide py-2"
        >
          {filteredMints.map((mint) => (
            <div
              key={mint.url}
              className="snap-center snap-always shrink-0"
            >
              <MintCard
                mint={mint}
                {...resolveMintColor(mint.url, settings.mints.indexOf(mint.url), settings.mintColors)}
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
                  localSelected === mint.url ? 'bg-foreground' : 'bg-border'
                }`}
              />
            ))}
          </div>
        )}

        {/* Info text (e.g. estimated fee) */}
        {infoText && (
          <p className="text-center text-caption text-foreground-muted mt-2 px-6">
            {infoText}
          </p>
        )}

        {/* Confirm Button — pb-app keeps it clear of the home indicator now that
            viewport-fit=cover extends the sheet to the physical screen edge. */}
        <div className="px-5 pt-4 pb-app">
          <Button
            variant="brand"
            size="xl"
            disabled={!localSelected || (!allowEmpty && !selectedHasBalance)}
            onClick={handleConfirm}
            className="w-full"
          >
            {buttonLabel || t('payment.selectThisMint')}
          </Button>
        </div>
      </motion.div>
    </>,
    document.body,
  )
}
