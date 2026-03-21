import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WalletBalance } from '@/core/types'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { formatMintHost } from '@/utils/url'

export interface BalanceDisplayProps {
  balance: WalletBalance
  isLoading?: boolean
  size?: 'default' | 'large'
}

export function BalanceDisplay({
  balance,
  isLoading = false,
  size = 'default',
}: BalanceDisplayProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()
  const formatFiat = useFormatFiat()
  const isLarge = size === 'large'
  const [showModal, setShowModal] = useState(false)

  const mintEntries = Object.entries(balance.byMint)
  const hasMints = mintEntries.length > 0

  // Show shimmer effect when refreshing (isLoading but already have balance)
  // Show skeleton only on initial load (isLoading and no balance yet)
  const hasExistingBalance = balance.total > 0 || hasMints
  const isSyncing = isLoading && hasExistingBalance
  const isInitialLoad = isLoading && !hasExistingBalance


  return (
    <>
      {/* Main Balance - Clickable */}
      <button
        onClick={() => hasMints && setShowModal(true)}
        disabled={!hasMints}
        className={`
          w-full text-left transition-all
          ${hasMints ? 'cursor-pointer hover:bg-muted/50 rounded-lg p-2 -m-2 active:scale-[0.98] active:opacity-80' : ''}
        `}
      >
        <div className={`flex items-baseline gap-2 ${isLarge ? 'justify-center' : ''}`}>
          {isInitialLoad ? (
            <span className={isLarge ? 'text-display font-bold' : 'text-amount-lg font-bold'}>
              <span className={`inline-block ${isLarge ? 'w-28 h-10' : 'w-16 h-6'} bg-muted animate-pulse rounded`} />
            </span>
          ) : (
            <span className={`font-display font-bold tabular-nums ${isLarge ? 'text-display' : 'text-amount-lg'} ${isSyncing ? 'animate-shimmer' : ''}`}>
              {formatSats(balance.total)}
            </span>
          )}
          {(() => { const f = formatFiat(balance.total); return !isInitialLoad && f ? (
            <span className={`text-foreground-muted ${isLarge ? 'text-caption' : 'text-label'}`}>
              {f}
            </span>
          ) : null })()}
        </div>
      </button>

      {/* Mint Details Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-background rounded-lg p-4 mx-3 max-w-sm w-full shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-body font-semibold">{t('mintDetails.mintBalance')}</h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg hover:bg-muted transition-all active:scale-90"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Mint List */}
            <div className="space-y-2 mb-3">
              {mintEntries.map(([mintUrl, amount]) => (
                <div
                  key={mintUrl}
                  className="flex items-center justify-between p-2 bg-muted/50 rounded-md"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-status-online" />
                    <span className="text-label truncate max-w-[150px]">
                      {formatMintHost(mintUrl)}
                    </span>
                  </div>
                  <span className="font-display tabular-nums text-label">
                    {formatSats(amount)}
                  </span>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="flex items-center justify-between p-2 border-t border-border">
              <span className="text-label">{t('home.totalBalance')}</span>
              <span className="font-display font-bold tabular-nums text-body">
                {formatSats(balance.total)}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
