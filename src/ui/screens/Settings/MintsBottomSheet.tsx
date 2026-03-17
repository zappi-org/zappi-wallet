import { Plus, ChevronRight } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { BottomSheet, Modal } from '../../components/common'
import { cn } from '@/components/ui/utils'
import { useFormatSats } from '@/utils/format'
import { LIMITS } from '@/core/constants'
import { MintDetailsModal, type MintInfo } from '@/ui/components/modals/MintDetailsModal'
import { MintIcon } from './SettingsHelpers'
import type { MintHealthStatus } from '@/services/mint-health'

export interface MintsBottomSheetProps {
  isOpen: boolean
  mints: string[]
  balanceByMint: Record<string, number>
  selectedMint: MintInfo | null
  mintToDelete: string | null
  getDisplayName: (url: string) => string
  getIconUrl: (url: string) => string | undefined
  getCachedStatus: (url: string) => MintHealthStatus | null
  onClose: () => void
  onAddMint: () => void
  onSelectMint: (mint: MintInfo) => void
  onCloseMintDetails: () => void
  onRemoveMint: (url: string) => void
  onConfirmRemoveMint: () => void
  onCancelRemoveMint: () => void
}

export function MintsBottomSheet({
  isOpen,
  mints,
  balanceByMint,
  selectedMint,
  mintToDelete,
  getDisplayName,
  getIconUrl,
  getCachedStatus,
  onClose,
  onAddMint,
  onSelectMint,
  onCloseMintDetails,
  onRemoveMint,
  onConfirmRemoveMint,
  onCancelRemoveMint,
}: MintsBottomSheetProps) {
  const { t } = useTranslation()
  const formatSats = useFormatSats()

  return (
    <>
      <BottomSheet
        isOpen={isOpen}
        onClose={onClose}
        title={
          <div className="flex items-center justify-between w-full">
            <span>{t('settings.manageMints')}</span>
            <span className={cn(
              "text-[11px] font-semibold",
              mints.length >= LIMITS.MAX_MINTS
                ? "text-accent-danger"
                : "text-foreground-muted"
            )}>
              {mints.length}/{LIMITS.MAX_MINTS}
            </span>
          </div>
        }
      >
        <div className="p-4 space-y-3">
          {/* Add Mint Button */}
          <button
            onClick={onAddMint}
            disabled={mints.length >= LIMITS.MAX_MINTS}
            className={cn(
              'w-full py-2.5 rounded-sm font-semibold text-[13px] flex items-center justify-center gap-2 transition-colors',
              mints.length >= LIMITS.MAX_MINTS
                ? 'bg-foreground/[0.04] text-foreground-muted cursor-not-allowed'
                : 'bg-primary text-white active:opacity-80'
            )}
          >
            <Plus className="w-4 h-4" />
            {t('settings.addMint')}
          </button>
          {mints.length >= LIMITS.MAX_MINTS && (
            <p className="text-[11px] text-accent-danger text-center">{t('settings.mintDeleteMaxReached')}</p>
          )}

          <div className="divide-y divide-border">
            {mints.length === 0 ? (
              <p className="text-[12px] text-foreground-muted text-center py-3">{t('settings.noMints')}</p>
            ) : (
              mints.map((mint) => {
                const normalizedMint = mint.endsWith('/') ? mint.slice(0, -1) : mint
                const mintBalance = balanceByMint[normalizedMint] || balanceByMint[mint] || 0
                return (
                  <button
                    key={mint}
                    onClick={() => onSelectMint({ url: mint, name: getDisplayName(mint), balance: mintBalance, isOnline: getCachedStatus(mint)?.isOnline })}
                    className="w-full px-1 py-3 flex items-center gap-3 active:bg-background-hover text-left"
                  >
                    <MintIcon url={mint} getIconUrl={getIconUrl} size="md" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-medium text-foreground truncate block">{getDisplayName(mint)}</span>
                      <span className="text-[11px] text-foreground-muted truncate block">{mint.replace('https://', '')}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-semibold text-foreground">
                        {formatSats(mintBalance)}
                      </span>
                      <ChevronRight className="w-4 h-4 text-foreground-subtle" />
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </BottomSheet>

      {/* Mint Delete Confirmation Modal */}
      <Modal isOpen={!!mintToDelete} onClose={onCancelRemoveMint} title={t('settings.deleteMint')}>
        <div className="py-3 space-y-3">
          <p className="text-[12px] text-foreground-muted">
            {(() => {
              const url = mintToDelete || ''
              const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url
              const balance = balanceByMint[normalizedUrl] || balanceByMint[url] || 0
              return (
                <Trans
                  i18nKey="settings.mintHasBalance"
                  values={{ formattedBalance: formatSats(balance) }}
                  components={{ bold: <strong className="font-semibold text-foreground" /> }}
                />
              )
            })()}
          </p>
          <p className="text-[12px] text-accent-danger font-semibold">{t('settings.deleteWarning')}</p>
          <div className="flex gap-2">
            <button
              onClick={onCancelRemoveMint}
              className="flex-1 py-2.5 rounded-sm bg-background text-foreground font-semibold text-[13px] active:opacity-80 border border-border"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={onConfirmRemoveMint}
              className="flex-1 py-2.5 rounded-sm bg-accent-danger text-white font-semibold text-[13px] active:opacity-80"
            >
              {t('common.delete')}
            </button>
          </div>
        </div>
      </Modal>

      {/* Mint Details Modal */}
      <MintDetailsModal
        isOpen={!!selectedMint}
        mint={selectedMint}
        onClose={onCloseMintDetails}
        onDelete={onRemoveMint}
      />
    </>
  )
}
