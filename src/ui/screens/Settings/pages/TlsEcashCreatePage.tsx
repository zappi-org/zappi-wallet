import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Coins, RotateCcw, ChevronRight, ClipboardCopy } from 'lucide-react'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useAppStore } from '@/store'
import { sat } from '@/core/domain/amount'
import { Button } from '@/ui/components/common/Button'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'

interface TlsEcashCreatePageProps {
  onBack: () => void
}

function getTokenFromTransfer(transfer: { transportRef?: unknown }): string | null {
  const ref = transfer.transportRef as { token?: string } | undefined
  return ref?.token ?? null
}

export function TlsEcashCreatePage({ onBack }: TlsEcashCreatePageProps) {
  const { t } = useTranslation()
  void t
  const registry = useServiceRegistry()
  const activeMintUrl = useAppStore((s) => s.activeMintUrl)
  const pendingTransfers = useAppStore((s) => s.pendingTransfers)
  const addToast = useAppStore((s) => s.addToast)

  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(activeMintUrl)
  const [mintSheetOpen, setMintSheetOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [recipient, setRecipient] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!selectedMintUrl) {
      addToast({ type: 'error', message: 'Select a mint first' })
      return
    }
    if (!amount.trim()) {
      addToast({ type: 'error', message: 'Amount required' })
      return
    }

    setIsLoading(true)
    setLastResult(null)

    try {
      const txId = crypto.randomUUID()
      const transfer = await registry.transferLifecycle.initiateTransfer(
        {
          txId,
          accountId: selectedMintUrl,
          amount: sat(Number(amount)),
          ...(recipient.trim() && { recipient: recipient.trim() }),
          memo: memo.trim() || undefined,
        },
        'ecash',
      )
      setLastResult(`Created: ${transfer.id}\nPhase: ${transfer.phase}`)
      addToast({ type: 'success', message: `Ecash TLS ${transfer.phase}` })
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

  const copyToken = (token: string) => {
    void navigator.clipboard.writeText(token)
    addToast({ type: 'success', message: 'Token copied to clipboard' })
  }

  const sorted = [...pendingTransfers].sort((a, b) => b.createdAt - a.createdAt)

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
          TLS Ecash Create
        </h1>
        <div className="w-10" />
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-6">
        {/* Inputs */}
        <div className="bg-background-card rounded-card p-4 space-y-3">
          {/* Mint selector */}
          <button
            onClick={() => setMintSheetOpen(true)}
            className="w-full text-left bg-background rounded-lg px-3 py-2.5 flex items-center justify-between border border-foreground/10 active:opacity-80 transition-all"
          >
            <div className="min-w-0">
              <p className="text-caption text-foreground-muted">Mint</p>
              <p className="text-body truncate">{selectedMintUrl ?? 'Select a mint'}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-foreground-subtle shrink-0" strokeWidth={1.8} />
          </button>

          <div>
            <label className="text-caption text-foreground-muted block mb-1">Amount (sat)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-background text-foreground rounded-lg px-3 py-2 text-body border border-foreground/10 focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="1000"
            />
          </div>
          <div>
            <label className="text-caption text-foreground-muted block mb-1">Recipient npub (optional)</label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-full bg-background text-foreground rounded-lg px-3 py-2 text-body border border-foreground/10 focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="npub1... or leave empty for QR"
            />
          </div>
          <div>
            <label className="text-caption text-foreground-muted block mb-1">Memo</label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="w-full bg-background text-foreground rounded-lg px-3 py-2 text-body border border-foreground/10 focus:outline-none focus:ring-2 focus:ring-accent"
              placeholder="optional"
            />
          </div>
          <Button
            variant="brand"
            size="lg"
            onClick={handleCreate}
            loading={isLoading}
            icon={<Coins className="size-4" />}
            className="w-full mt-2"
          >
            Create Ecash Token
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
            <p className="text-caption text-foreground-muted mb-1">Last result</p>
            <pre className="text-body whitespace-pre-wrap break-all">{lastResult}</pre>
          </div>
        )}

        {/* Pending list */}
        <div>
          <h2 className="text-headline font-semibold mb-3">
            Pending Transfers ({sorted.length})
          </h2>
          {sorted.length === 0 ? (
            <p className="text-body text-foreground-muted">No pending transfers</p>
          ) : (
            <div className="flex flex-col gap-2">
              {sorted.map((t) => {
                const token = getTokenFromTransfer(t)
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
                    <p className="text-caption text-foreground-muted truncate">ID: {t.id}</p>
                    <p className="text-caption text-foreground-muted truncate">Tx: {t.txId}</p>
                    <p className="text-caption text-foreground-muted">
                      {new Date(t.createdAt).toLocaleTimeString()}
                    </p>
                    {/* Token display & copy */}
                    {token && (
                      <div className="mt-2 pt-2 border-t border-foreground/10 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-caption text-foreground-muted">Token</p>
                          <button
                            onClick={() => copyToken(token)}
                            className="p-1.5 rounded-md bg-background active:opacity-70 transition-opacity"
                          >
                            <ClipboardCopy className="w-3.5 h-3.5" strokeWidth={1.8} />
                          </button>
                        </div>
                        <p className="text-body break-all font-mono text-xs text-foreground/80">{token}</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Mint Bottom Sheet */}
      <MintSelectBottomSheet
        isOpen={mintSheetOpen}
        onClose={() => setMintSheetOpen(false)}
        onSelect={(url) => {
          setSelectedMintUrl(url)
          setMintSheetOpen(false)
        }}
        selectedMintUrl={selectedMintUrl}
        allowEmpty
      />
    </div>
  )
}
