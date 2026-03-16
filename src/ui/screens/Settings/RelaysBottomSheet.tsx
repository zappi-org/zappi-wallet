import { Server, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '../../components/common'
import { cn } from '@/components/ui/utils'
import { LIMITS } from '@/core/constants'

export interface RelaysBottomSheetProps {
  isOpen: boolean
  relays: string[]
  newRelayUrl: string
  isValidatingRelay: boolean
  relayError: string
  onClose: () => void
  onNewRelayUrlChange: (value: string) => void
  onRelayErrorClear: () => void
  onAddRelay: () => void
  onRemoveRelay: (url: string) => void
}

export function RelaysBottomSheet({
  isOpen,
  relays,
  newRelayUrl,
  isValidatingRelay,
  relayError,
  onClose,
  onNewRelayUrlChange,
  onRelayErrorClear,
  onAddRelay,
  onRemoveRelay,
}: RelaysBottomSheetProps) {
  const { t } = useTranslation()

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center justify-between w-full">
          <span>{t('settings.manageRelays')}</span>
          <span className={cn(
            "text-[11px] font-semibold",
            relays.length >= LIMITS.MAX_RELAYS
              ? "text-accent-danger"
              : "text-foreground-muted"
          )}>
            {relays.length}/{LIMITS.MAX_RELAYS}
          </span>
        </div>
      }
    >
      <div className="p-4 space-y-3">
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t('settings.relayPlaceholder')}
              value={newRelayUrl}
              onChange={(e) => { onNewRelayUrlChange(e.target.value); onRelayErrorClear() }}
              disabled={isValidatingRelay || relays.length >= LIMITS.MAX_RELAYS}
              className="flex-1 bg-background p-2.5 rounded-sm border border-border outline-none text-[13px] text-foreground placeholder:text-foreground-muted/50 font-medium disabled:opacity-50 focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={onAddRelay}
              disabled={!newRelayUrl.trim() || isValidatingRelay || relays.length >= LIMITS.MAX_RELAYS}
              className={cn(
                'px-3 py-2.5 rounded-sm font-semibold text-[13px] flex items-center gap-2 transition-colors',
                !newRelayUrl.trim() || isValidatingRelay || relays.length >= LIMITS.MAX_RELAYS
                  ? 'bg-primary/30 text-white/50 cursor-not-allowed'
                  : 'bg-primary text-white active:opacity-80'
              )}
            >
              {isValidatingRelay ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              {t('common.add')}
            </button>
          </div>
          {relayError && <p className="text-[11px] text-accent-danger font-semibold ml-1">{relayError}</p>}
          {relays.length >= LIMITS.MAX_RELAYS && !relayError && (
            <p className="text-[11px] text-accent-danger ml-1">{t('settings.relayDeleteRequired')}</p>
          )}
        </div>

        <div className="divide-y divide-border">
          {relays.length === 0 ? (
            <p className="text-[12px] text-foreground-muted text-center py-3">{t('settings.noRelays')}</p>
          ) : (
            relays.map((relay) => (
              <div key={relay} className="px-1 py-3 flex items-center gap-3">
                <div className="w-8 h-8 rounded-sm bg-foreground/[0.06] flex items-center justify-center shrink-0">
                  <Server className="w-4 h-4 text-foreground-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-foreground truncate block">{relay.replace('wss://', '').replace('ws://', '')}</span>
                  <span className="text-[11px] text-foreground-muted">{t('settings.nostrRelay')}</span>
                </div>
                <button
                  onClick={() => onRemoveRelay(relay)}
                  className="p-2 text-foreground-muted active:text-accent-danger shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </BottomSheet>
  )
}
