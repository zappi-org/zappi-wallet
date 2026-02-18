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
            "text-[10px] font-bold px-2 py-0.5 rounded-full",
            relays.length >= LIMITS.MAX_RELAYS
              ? "bg-accent-danger/20 text-accent-danger"
              : "bg-primary/10 text-foreground-muted"
          )}>
            {relays.length}/{LIMITS.MAX_RELAYS}
          </span>
        </div>
      }
    >
      <div className="p-3 space-y-3">
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={t('settings.relayPlaceholder')}
              value={newRelayUrl}
              onChange={(e) => { onNewRelayUrlChange(e.target.value); onRelayErrorClear() }}
              disabled={isValidatingRelay || relays.length >= LIMITS.MAX_RELAYS}
              className="flex-1 bg-white/60 p-2 rounded-xl border border-white/50 outline-none text-foreground placeholder:text-foreground-muted/50 font-medium disabled:opacity-50"
            />
            <button
              onClick={onAddRelay}
              disabled={!newRelayUrl.trim() || isValidatingRelay || relays.length >= LIMITS.MAX_RELAYS}
              className={cn(
                'px-3 py-2 rounded-xl font-bold flex items-center gap-2 transition-all',
                !newRelayUrl.trim() || isValidatingRelay || relays.length >= LIMITS.MAX_RELAYS
                  ? 'bg-primary/30 text-white/50 cursor-not-allowed'
                  : 'bg-primary text-white hover:bg-primary-hover'
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
          {relayError && <p className="text-[10px] text-accent-danger font-bold ml-2">{relayError}</p>}
          {relays.length >= LIMITS.MAX_RELAYS && !relayError && (
            <p className="text-[10px] text-accent-danger ml-2">{t('settings.relayDeleteRequired')}</p>
          )}
        </div>

        <div className="space-y-2">
          {relays.length === 0 ? (
            <p className="text-xs text-foreground-muted text-center py-3">{t('settings.noRelays')}</p>
          ) : (
            relays.map((relay) => (
              <div key={relay} className="bg-white/60 p-3 rounded-xl border border-white/50 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-accent-primary flex items-center justify-center shrink-0">
                  <Server className="w-4 h-4 text-white/80" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-bold text-foreground truncate block">{relay.replace('wss://', '').replace('ws://', '')}</span>
                  <span className="text-[10px] text-foreground-muted">{t('settings.nostrRelay')}</span>
                </div>
                <button
                  onClick={() => onRemoveRelay(relay)}
                  className="p-2 text-accent-danger opacity-50 hover:opacity-100 transition-opacity shrink-0"
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
