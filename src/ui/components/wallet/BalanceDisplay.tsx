import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WalletBalance } from '@/core/types'
import { satUnit } from '@/utils/format'

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
  const isLarge = size === 'large'
  const [showModal, setShowModal] = useState(false)

  const mintEntries = Object.entries(balance.byMint)
  const hasMints = mintEntries.length > 0

  // Show shimmer effect when refreshing (isLoading but already have balance)
  // Show skeleton only on initial load (isLoading and no balance yet)
  const hasExistingBalance = balance.total > 0 || hasMints
  const isSyncing = isLoading && hasExistingBalance
  const isInitialLoad = isLoading && !hasExistingBalance

  const formatMintUrl = (url: string) => {
    try {
      const parsed = new URL(url)
      return parsed.hostname
    } catch {
      return url
    }
  }

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
          <span className={`text-muted-foreground ${isLarge ? 'text-base' : 'text-xs'}`}>{satUnit(balance.total)}</span>
          {isInitialLoad ? (
            <span className={isLarge ? 'text-4xl font-bold' : 'text-2xl font-bold'}>
              <span className={`inline-block ${isLarge ? 'w-28 h-10' : 'w-16 h-6'} bg-muted animate-pulse rounded`} />
            </span>
          ) : (
            <span className={`font-bold tabular-nums ${isLarge ? 'text-4xl' : 'text-2xl'} ${isSyncing ? 'animate-shimmer' : ''}`}>
              {balance.total.toLocaleString()}
            </span>
          )}
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
              <h3 className="text-base font-semibold">{t('mintDetails.mintBalance')}</h3>
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
                    <span className="text-xs truncate max-w-[150px]">
                      {formatMintUrl(mintUrl)}
                    </span>
                  </div>
                  <span className="font-medium tabular-nums text-xs">
                    {satUnit(amount)} {amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            {/* Total */}
            <div className="flex items-center justify-between p-2 border-t border-border">
              <span className="font-medium text-xs">{t('home.totalBalance')}</span>
              <span className="font-bold tabular-nums text-base">
                {satUnit(balance.total)} {balance.total.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
