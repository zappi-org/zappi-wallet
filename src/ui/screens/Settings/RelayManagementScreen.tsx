import { useState, useCallback, useEffect, useRef } from 'react'
import { ArrowLeft, Plus, Trash2, Server, AlertCircle } from 'lucide-react'
import { Reorder } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { Button } from '@/ui/components/common/Button'
import { normalizeRelayUrl } from '@/utils/url'
import { LIMITS } from '@/core/constants'
import { cn } from '@/ui/lib/utils'
import { Modal } from '@/ui/components/common'
import { isSameOrder, moveItem, reconcileOrder } from '@/utils/reorder'
import { ReorderableSettingItem } from './ReorderableSettingItem'

export interface RelayManagementScreenProps {
  onBack: () => void
  onSaveSettings: (settings: Record<string, unknown>) => Promise<void>
}

export function RelayManagementScreen({
  onBack,
  onSaveSettings,
}: RelayManagementScreenProps) {
  const { t } = useTranslation()
  const registry = useServiceRegistry()
  const settings = useAppStore((s) => s.settings)
  const addToast = useAppStore((s) => s.addToast)
  const relays = settings.relays

  const [newRelayUrl, setNewRelayUrl] = useState('')
  const [isValidating, setIsValidating] = useState(false)
  const [error, setError] = useState('')
  const [relayToDelete, setRelayToDelete] = useState<string | null>(null)
  const [orderedRelays, setOrderedRelays] = useState(relays)

  // Relay health status
  const [relayStatus, setRelayStatus] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const orderedRelayList = reconcileOrder(orderedRelays, relays)

  const emptySlots = LIMITS.MAX_RELAYS - relays.length
  const isAtLimit = relays.length >= LIMITS.MAX_RELAYS

  // Liveness display: read the connection state the controller already maintains.
  // Previously each mount opened a fresh raw WebSocket to every configured relay
  // (a burst of duplicate connections). This reads a memory snapshot, so
  // short-interval polling is free.
  useEffect(() => {
    const readStatus = () => {
      const statuses = registry.nostrGateway.getRelayStatus()
      setRelayStatus((prev) => {
        // Keep the previous reference when nothing changed — avoids re-rendering the whole screen on every 5s poll
        let changed = false
        const next = { ...prev }
        for (const s of statuses) {
          if (next[s.url] !== s.connected) {
            next[s.url] = s.connected
            changed = true
          }
        }
        return changed ? next : prev
      })
    }
    readStatus()
    const timer = setInterval(readStatus, 5000)
    return () => clearInterval(timer)
  }, [registry])

  const handleAdd = useCallback(async () => {
    if (!newRelayUrl.trim()) return
    setError('')

    if (isAtLimit) {
      setError(t('settings.maxRelaysReached', { max: LIMITS.MAX_RELAYS }))
      return
    }

    const url = normalizeRelayUrl(newRelayUrl)

    if (relays.includes(url)) {
      setError(t('settings.relayExists'))
      return
    }

    setIsValidating(true)
    try {
      const ws = new WebSocket(url)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')) }, 5000)
        ws.onopen = () => { clearTimeout(timeout); ws.close(); resolve() }
        ws.onerror = () => { clearTimeout(timeout); reject(new Error('failed')) }
      })
      const newRelays = [...relays, url]
      await onSaveSettings({ relays: newRelays })
      setNewRelayUrl('')
      setRelayStatus((p) => ({ ...p, [url]: true }))
    } catch {
      setError(t('settings.relayConnectionFailed'))
    } finally {
      setIsValidating(false)
    }
  }, [newRelayUrl, relays, isAtLimit, onSaveSettings, t])

  const isAtMinimum = relays.length <= LIMITS.MIN_RELAYS

  const confirmRemoveRelay = useCallback(async () => {
    if (!relayToDelete) return
    if (relays.length <= LIMITS.MIN_RELAYS) {
      setRelayToDelete(null)
      return
    }
    const urlToDelete = relayToDelete
    setRelayToDelete(null)
    const newRelays = relays.filter((r) => r !== urlToDelete)
    await onSaveSettings({ relays: newRelays })
  }, [relayToDelete, relays, onSaveSettings])

  const persistRelayOrder = useCallback(async (nextRelays: string[]) => {
    if (isSameOrder(nextRelays, relays)) {
      return
    }

    try {
      await onSaveSettings({ relays: nextRelays })
    } catch {
      setOrderedRelays(relays)
      addToast({ type: 'error', message: t('errors.unknownError') })
    }
  }, [relays, onSaveSettings, addToast, t])

  const commitDraggedRelayOrder = useCallback(async () => {
    await persistRelayOrder(orderedRelayList)
  }, [orderedRelayList, persistRelayOrder])

  const handleMoveRelay = useCallback(async (url: string, direction: 'up' | 'down') => {
    const currentIndex = orderedRelayList.indexOf(url)
    if (currentIndex < 0) {
      return
    }

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
    const newRelays = moveItem(orderedRelayList, currentIndex, targetIndex)
    if (newRelays === orderedRelayList) {
      return
    }

    setOrderedRelays(newRelays)
    await persistRelayOrder(newRelays)
  }, [orderedRelayList, persistRelayOrder])

  const formatRelayUrl = (url: string) => url.replace('wss://', '').replace('ws://', '')

  return (
    <div className="fixed inset-0 bg-background text-foreground flex flex-col pt-safe overflow-hidden z-[60]">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0">
        <button
          onClick={onBack}
          aria-label={t('common.back')}
          className="w-10 h-10 -ml-1.5 rounded-lg flex items-center justify-center hover:bg-foreground/[0.04] active:bg-foreground/[0.06] transition-colors z-10"
        >
          <ArrowLeft className="w-[22px] h-[22px] text-foreground" strokeWidth={1.8} />
        </button>
        <h2 className="absolute inset-0 flex items-center justify-center text-subtitle font-semibold pointer-events-none">{t('settings.manageRelays')}</h2>
        <span className={cn(
          "text-caption font-semibold font-mono z-10 tabular-nums",
          isAtLimit ? "text-accent-danger" : "text-foreground-muted"
        )}>
          {relays.length}<span className="text-foreground-muted/50">/{LIMITS.MAX_RELAYS}</span>
        </span>
      </header>

      {/* URL Input */}
      <div className="px-4 pt-4 pb-2 space-y-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={newRelayUrl}
            onChange={(e) => { setNewRelayUrl(e.target.value); setError('') }}
            placeholder={t('settings.relayPlaceholder')}
            disabled={isValidating || isAtLimit}
            className="flex-1 px-3 py-2.5 rounded-xl bg-background border border-border text-caption focus:outline-none focus:ring-1 focus:ring-foreground/20 placeholder:text-foreground-muted/50 disabled:opacity-50"
          />
          <button
            onClick={handleAdd}
            disabled={!newRelayUrl.trim() || isValidating || isAtLimit}
            className={cn(
              'px-4 py-2.5 rounded-xl font-semibold text-caption shrink-0 flex items-center gap-2 transition-colors',
              newRelayUrl.trim() && !isValidating && !isAtLimit
                ? 'bg-brand text-white active:opacity-80'
                : 'bg-foreground/10 text-foreground-muted cursor-not-allowed'
            )}
          >
            {isValidating ? (
              <div className="w-4 h-4 border-2 border-foreground-muted/30 border-t-foreground-muted rounded-full animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-1.5 text-accent-danger ml-1">
            <AlertCircle className="w-3 h-3 shrink-0" />
            <p className="text-overline font-medium">{error}</p>
          </div>
        )}
        {isAtLimit && !error && (
          <p className="text-overline font-medium text-accent-danger ml-1">
            {t('settings.relayDeleteRequired')}
          </p>
        )}
        {isAtMinimum && !error && (
          <p className="text-overline font-medium text-foreground-muted ml-1">
            {t('settings.minRelaysRequired', { min: LIMITS.MIN_RELAYS })}
          </p>
        )}
      </div>

      {/* Relay List */}
      <div className="flex-1 overflow-y-auto">
        <p className="px-5 pb-2 text-overline font-medium text-foreground-muted">
          {t('settings.reorderHint')}
        </p>
        <Reorder.Group
          as="div"
          axis="y"
          values={orderedRelayList}
          onReorder={setOrderedRelays}
          className="bg-background-card divide-y divide-border"
        >
          {/* Filled slots */}
          {orderedRelayList.map((url, index) => {
            const status = relayStatus[url]
            return (
              <ReorderableSettingItem
                key={url}
                value={url}
                dragTitle={`${t('settings.dragToReorder')} ${formatRelayUrl(url)}`}
                handleTestId="relay-drag-handle"
                onDragEnd={commitDraggedRelayOrder}
                onMoveUp={() => handleMoveRelay(url, 'up')}
                onMoveDown={() => handleMoveRelay(url, 'down')}
                canMoveUp={index > 0}
                canMoveDown={index < orderedRelayList.length - 1}
              >
                {(dragHandle) => (
              <div className="w-full py-3 flex items-stretch">
                {dragHandle}
                <div className="min-w-0 flex flex-1 items-center gap-3 pr-4">
                  <div className="w-8 h-8 rounded-lg bg-foreground/[0.06] flex items-center justify-center shrink-0">
                    <Server className="w-4 h-4 text-foreground-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-caption font-medium text-foreground truncate">
                        {formatRelayUrl(url)}
                      </span>
                      {index === 0 && (
                        <span className="rounded-full bg-brand/10 px-2 py-0.5 text-overline font-semibold text-brand">
                          {t('settings.primary')}
                        </span>
                      )}
                      {status !== undefined && (
                        <span className={cn(
                          'w-1.5 h-1.5 rounded-full shrink-0',
                          status ? 'bg-accent-primary' : 'bg-accent-danger'
                        )} />
                      )}
                    </div>
                    <span className="text-label font-medium text-foreground-muted">{t('settings.nostrRelay')}</span>
                  </div>
                  <button
                    onClick={() => !isAtMinimum && setRelayToDelete(url)}
                    disabled={isAtMinimum}
                    className={cn(
                      "p-2 shrink-0",
                      isAtMinimum
                        ? "text-foreground-muted/30 cursor-not-allowed"
                        : "text-foreground-muted active:text-accent-danger"
                    )}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
                )}
              </ReorderableSettingItem>
            )
          })}
        </Reorder.Group>

        {emptySlots > 0 && (
        <div className="bg-background-card divide-y divide-border border-t border-border">
          {/* Empty slots */}
          {Array.from({ length: emptySlots }, (_, i) => (
            <button
              key={`add-${i}`}
              onClick={() => inputRef.current?.focus()}
              className="w-full px-4 py-3 flex items-center gap-3 active:bg-background-hover text-left"
            >
              <div className="w-8 h-8 rounded-lg border border-dashed border-foreground/20 flex items-center justify-center shrink-0">
                <Plus className="w-4 h-4 text-foreground-muted" />
              </div>
              <span className="text-caption text-foreground-muted">{t('settings.addRelay')}</span>
            </button>
          ))}
        </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!relayToDelete} onClose={() => setRelayToDelete(null)} title={t('settings.deleteRelay')}>
        <div className="py-4 space-y-4">
          <div className="text-center space-y-1">
            <p className="text-subtitle font-semibold text-accent-primary">
              {relayToDelete ? formatRelayUrl(relayToDelete) : ''}
            </p>
            <p className="text-body text-foreground">
              {t('settings.confirmDeleteRelay')}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="lg" onClick={() => setRelayToDelete(null)} className="flex-1">
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" size="lg" onClick={confirmRemoveRelay} className="flex-1">
              {t('common.delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

export default RelayManagementScreen
