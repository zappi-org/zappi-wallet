import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { MintInfo } from '@/core/types'
import cardLogo from '@/assets/card-logo.svg'
import { BottomSheet } from './BottomSheet'
import { cn } from '@/lib/utils'

export interface MintFilterSheetProps {
  isOpen: boolean
  onClose: () => void
  mints: MintInfo[]
  selectedUrls: Set<string>
  onChange: (urls: Set<string>) => void
}

function MintLogo({ iconUrl }: { iconUrl?: string }) {
  const [hasError, setHasError] = useState(false)

  if (!iconUrl || hasError) {
    return (
      <div className="w-8 h-8 rounded-full bg-background-card flex items-center justify-center flex-shrink-0">
        <img src={cardLogo} alt="" className="w-5 h-5 object-contain" />
      </div>
    )
  }

  return (
    <img
      src={iconUrl}
      alt=""
      className="w-8 h-8 rounded-full object-cover flex-shrink-0"
      onError={() => setHasError(true)}
    />
  )
}

function MintFilterContent({
  mints,
  selectedUrls,
  onChange,
}: {
  mints: MintInfo[]
  selectedUrls: Set<string>
  onChange: (urls: Set<string>) => void
}) {
  const { t } = useTranslation()

  const isAllSelected = selectedUrls.size === 0

  const handleToggleAll = useCallback(() => {
    onChange(new Set())
  }, [onChange])

  const handleToggleMint = useCallback(
    (url: string) => {
      const next = new Set(selectedUrls)
      if (next.has(url)) {
        next.delete(url)
      } else {
        next.add(url)
      }
      // If all mints are now selected, reset to empty (= show all)
      if (next.size === mints.length) {
        onChange(new Set())
      } else {
        onChange(next)
      }
    },
    [selectedUrls, mints.length, onChange],
  )

  return (
    <div className="py-1">
      {/* All wallets option */}
      <button
        onClick={handleToggleAll}
        className={cn(
          'w-full flex items-center gap-3 px-5 py-3 min-h-[48px] text-left transition-colors',
          isAllSelected ? 'bg-primary/8' : 'active:bg-foreground-subtle/10',
        )}
      >
        <div className="flex-1 min-w-0">
          <span
            className={cn(
              'text-label font-medium',
              isAllSelected ? 'text-primary' : 'text-foreground',
            )}
          >
            {t('history.allMints')}
          </span>
        </div>
        {isAllSelected && (
          <Check className="w-[18px] h-[18px] text-primary flex-shrink-0" strokeWidth={1.8} />
        )}
      </button>

      <div className="h-px bg-border/30 mx-5" />

      {/* Individual mints */}
      {mints.map((mint) => {
        const isSelected = selectedUrls.has(mint.url)
        const displayName = mint.name || mint.alias || mint.mintName || mint.url

        return (
          <button
            key={mint.url}
            onClick={() => handleToggleMint(mint.url)}
            className={cn(
              'w-full flex items-center gap-3 px-5 py-3 min-h-[48px] text-left transition-colors',
              isSelected ? 'bg-primary/8' : 'active:bg-foreground-subtle/10',
            )}
          >
            {/* Mint icon */}
            <MintLogo iconUrl={mint.iconUrl} />

            <div className="flex-1 min-w-0">
              <div
                className={cn(
                  'text-label font-medium truncate',
                  isSelected ? 'text-primary' : 'text-foreground',
                )}
              >
                {displayName}
              </div>
              <div className="text-overline font-medium text-foreground-muted">
                {mint.balance.toLocaleString()} sats
              </div>
            </div>

            {isSelected && (
              <Check className="w-[18px] h-[18px] text-primary flex-shrink-0" strokeWidth={1.8} />
            )}
          </button>
        )
      })}
    </div>
  )
}

export function MintFilterSheet({
  isOpen,
  onClose,
  mints,
  selectedUrls,
  onChange,
}: MintFilterSheetProps) {
  const { t } = useTranslation()

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('history.mintFilter')}>
      <MintFilterContent mints={mints} selectedUrls={selectedUrls} onChange={onChange} />
    </BottomSheet>
  )
}
