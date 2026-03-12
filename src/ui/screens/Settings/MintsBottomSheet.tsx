import { Plus, ChevronRight } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { BottomSheet, Modal, Button } from '../../components/common'
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
              "text-[10px] font-bold px-2 py-0.5 rounded-full",
              mints.length >= LIMITS.MAX_MINTS
                ? "bg-accent-danger/20 text-accent-danger"
                : "bg-primary/10 text-foreground-muted"
            )}>
              {mints.length}/{LIMITS.MAX_MINTS}
            </span>
          </div>
        }
      >
        <div className="p-3 space-y-3">
          {/* Add Mint Button */}
          <button
            onClick={onAddMint}
            disabled={mints.length >= LIMITS.MAX_MINTS}
            className={cn(
              'w-full p-3 rounded-xl border flex items-center justify-center gap-2 font-bold transition-all',
              mints.length >= LIMITS.MAX_MINTS
                ? 'bg-foreground-muted/10 border-foreground-muted/20 text-foreground-muted/50 cursor-not-allowed'
                : 'bg-primary border-primary text-white hover:bg-primary-hover'
            )}
          >
            <Plus className="w-4 h-4" />
            {t('settings.addMint')}
          </button>
          {mints.length >= LIMITS.MAX_MINTS && (
            <p className="text-[10px] text-accent-danger text-center">{t('settings.mintDeleteMaxReached')}</p>
          )}

          <div className="space-y-2">
            {mints.length === 0 ? (
              <p className="text-xs text-foreground-muted text-center py-3">{t('settings.noMints')}</p>
            ) : (
              mints.map((mint) => {
                // Normalize URL for balance lookup (remove trailing slash)
                const normalizedMint = mint.endsWith('/') ? mint.slice(0, -1) : mint
                const mintBalance = balanceByMint[normalizedMint] || balanceByMint[mint] || 0
                return (
                  <button
                    key={mint}
                    onClick={() => onSelectMint({ url: mint, name: getDisplayName(mint), balance: mintBalance, isOnline: getCachedStatus(mint)?.isOnline })}
                    className="w-full bg-white/60 p-3 rounded-xl border border-white/50 flex items-center gap-3 hover:bg-white/80 transition-colors text-left"
                  >
                    <MintIcon url={mint} getIconUrl={getIconUrl} size="md" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-bold text-foreground truncate block">{getDisplayName(mint)}</span>
                      <span className="text-[10px] text-foreground-muted truncate block">{mint.replace('https://', '')}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <span className="text-sm font-bold text-foreground">
                          {formatSats(mintBalance)}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-foreground-muted" />
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
          <p className="text-xs text-foreground-muted">
            {(() => {
              const url = mintToDelete || ''
              const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url
              const balance = balanceByMint[normalizedUrl] || balanceByMint[url] || 0
              return (
                <Trans
                  i18nKey="settings.mintHasBalance"
                  values={{ formattedBalance: formatSats(balance) }}
                  components={{ bold: <strong className="font-bold text-foreground" /> }}
                />
              )
            })()}
          </p>
          <p className="text-xs text-accent-danger font-bold">{t('settings.deleteWarning')}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={onCancelRemoveMint} className="flex-1">
              {t('common.cancel')}
            </Button>
            <button
              onClick={onConfirmRemoveMint}
              className="flex-1 p-2 rounded-xl bg-accent-danger text-white font-bold hover:bg-accent-danger-hover transition-colors shadow-lg shadow-accent-danger/30"
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
