import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useAppStore } from '@/store'
import { Button } from '@/ui/components/common/Button'

interface TlsGiftWrapPageProps {
  onBack: () => void
}

export function TlsGiftWrapPage({ onBack }: TlsGiftWrapPageProps) {
  const { t } = useTranslation()
  void t
  const registry = useServiceRegistry()
  const pendingTransfers = useAppStore((s) => s.pendingTransfers)
  const addToast = useAppStore((s) => s.addToast)

  const [isLoading, setIsLoading] = useState(false)

  const handlePoll = async () => {
    setIsLoading(true)
    try {
      await registry.transferLifecycle.pollPendingTransfers()
      addToast({ type: 'success', message: 'Poll complete' })
    } catch (err) {
      addToast({ type: 'error', message: String(err) })
    } finally {
      setIsLoading(false)
    }
  }

  const giftWrapTransfers = pendingTransfers.filter(
    (t) => (t.transportRef as { type?: string })?.type === 'nostr-giftwrap',
  )
  const sorted = [...giftWrapTransfers].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="h-full bg-background text-foreground flex flex-col overflow-hidden">
      {/* Header */}
      <header className="relative flex items-center justify-between px-5 h-14 shrink-0 z-50">
        <button
          onClick={onBack}
          className="w-10 h-10 flex items-center justify-center rounded-full active:bg-foreground/5"
        >
          <ArrowLeft className="w-5 h-5" strokeWidth={1.8} />
        </button>
        <h1 className="absolute left-0 right-0 text-center text-headline font-semibold pointer-events-none">
          TLS GiftWrap Receive
        </h1>
        <div className="w-10" />
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-6">
        {/* Info */}
        <div className="bg-background-card rounded-card p-4 space-y-3">
          <p className="text-body text-foreground-muted">
            NostrIncomingWatcher automatically subscribes to NIP-17 gift wraps
            and creates PendingTransfers. This page shows discovered giftwrap transfers.
          </p>
          <Button
            variant="outline"
            size="lg"
            onClick={handlePoll}
            loading={isLoading}
            icon={<RotateCcw className="size-4" />}
            className="w-full"
          >
            Poll Pending Transfers
          </Button>
        </div>

        {/* Gift-wrap list */}
        <div>
          <h2 className="text-headline font-semibold mb-3">
            GiftWrap Transfers ({sorted.length})
          </h2>
          {sorted.length === 0 ? (
            <p className="text-body text-foreground-muted">No giftwrap transfers found</p>
          ) : (
            <div className="flex flex-col gap-2">
              {sorted.map((t) => {
                const ref = t.transportRef as {
                  sender?: string
                  content?: string
                  eventId?: string
                }
                return (
                  <div key={t.id} className="bg-background-card rounded-card p-3 flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-caption font-semibold uppercase text-foreground-muted">
                        {t.direction}
                      </span>
                      <span
                        className={`text-label font-semibold px-2 py-0.5 rounded-full ${
                          t.phase === 'settled'
                            ? 'bg-accent-success/10 text-accent-success'
                            : t.phase === 'failed'
                              ? 'bg-accent-danger/10 text-accent-danger'
                              : 'bg-accent/10 text-accent'
                        }`}
                      >
                        {t.phase}
                      </span>
                    </div>
                    <p className="text-caption text-foreground-muted truncate">
                      Sender: {ref.sender ?? 'unknown'}
                    </p>
                    <p className="text-caption text-foreground-muted truncate">
                      Event: {ref.eventId?.substring(0, 20)}...
                    </p>
                    <p className="text-caption text-foreground-muted">
                      {new Date(t.createdAt).toLocaleTimeString()}
                    </p>
                    <p className="text-body break-all font-mono text-xs text-foreground/80 mt-1">
                      {ref.content?.substring(0, 120)}
                      {ref.content && ref.content.length > 120 ? '...' : ''}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
