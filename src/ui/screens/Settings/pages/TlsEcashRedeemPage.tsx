import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Wallet, RotateCcw } from 'lucide-react'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useAppStore } from '@/store'
import { Button } from '@/ui/components/common/Button'

interface TlsEcashRedeemPageProps {
  onBack: () => void
}

export function TlsEcashRedeemPage({ onBack }: TlsEcashRedeemPageProps) {
  const { t } = useTranslation()
  void t
  const registry = useServiceRegistry()
  const pendingTransfers = useAppStore((s) => s.pendingTransfers)
  const addToast = useAppStore((s) => s.addToast)

  const [token, setToken] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const handleRedeem = async () => {
    if (!token.trim()) {
      addToast({ type: 'error', message: 'Paste a token first' })
      return
    }

    setIsLoading(true)
    setLastResult(null)

    try {
      const result = await registry.incomingPayment.processIncoming({
        payload: token.trim(),
        externalId: crypto.randomUUID(),
      })
      setLastResult(
        `Status: ${result.status}\nAmount: ${result.amount ?? 'N/A'}\nFee: ${result.fee ?? 'N/A'}`,
      )
      if (result.status === 'success') {
        addToast({ type: 'success', message: `Redeemed ${result.amount} sat` })
      } else {
        addToast({ type: 'error', message: result.error ?? 'Redeem failed' })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLastResult(`Error: ${msg}`)
      addToast({ type: 'error', message: msg })
    } finally {
      setIsLoading(false)
    }
  }

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
          TLS Ecash Redeem
        </h1>
        <div className="w-10" />
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-6">
        {/* Input */}
        <div className="bg-background-card rounded-card p-4 space-y-3">
          <div>
            <label className="text-caption text-foreground-muted block mb-1">Cashu Token</label>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="w-full bg-background text-foreground rounded-lg px-3 py-2 text-body border border-foreground/10 focus:outline-none focus:ring-2 focus:ring-accent min-h-[120px] resize-y"
              placeholder="cashuA... or cashuB..."
            />
          </div>
          <Button
            variant="brand"
            size="lg"
            onClick={handleRedeem}
            loading={isLoading}
            icon={<Wallet className="size-4" />}
            className="w-full mt-2"
          >
            Redeem Token
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={handlePoll}
            loading={isLoading}
            icon={<RotateCcw className="size-4" />}
            className="w-full"
          >
            Poll Pending
          </Button>
        </div>

        {/* Result */}
        {lastResult && (
          <div className="bg-background-card rounded-card p-4">
            <p className="text-caption text-foreground-muted mb-1">Result</p>
            <pre className="text-body whitespace-pre-wrap break-all">{lastResult}</pre>
          </div>
        )}

        {/* Gift-wrap pending list */}
        <div>
          <h2 className="text-headline font-semibold mb-3">
            GiftWrap Transfers ({sorted.length})
          </h2>
          {sorted.length === 0 ? (
            <p className="text-body text-foreground-muted">No giftwrap transfers</p>
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
                      Event: {ref.eventId?.substring(0, 16)}...
                    </p>
                    <p className="text-body break-all font-mono text-xs text-foreground/80 mt-1">
                      {ref.content?.substring(0, 100)}
                      {ref.content && ref.content.length > 100 ? '...' : ''}
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
