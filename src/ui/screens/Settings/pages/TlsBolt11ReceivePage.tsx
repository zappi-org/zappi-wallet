import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ClipboardCopy, CheckCircle, ChevronRight, Zap } from 'lucide-react'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useAppStore } from '@/store'
import { sat } from '@/core/domain/amount'
import { canComplete } from '@/core/domain/pending-transfer'
import { Button } from '@/ui/components/common/Button'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'

interface TlsBolt11ReceivePageProps {
  onBack: () => void
}

type PageStatus = 'idle' | 'creating' | 'submitted' | 'awaiting_confirmation' | 'settled' | 'failed' | 'error' | 'claiming'

const stateColor: Record<string, string> = {
  submitted: 'text-accent',
  awaiting_confirmation: 'text-accent-success',
  settled: 'text-accent-success',
  failed: 'text-accent-danger',
  error: 'text-accent-danger',
}

export function TlsBolt11ReceivePage({ onBack }: TlsBolt11ReceivePageProps) {
  const { t } = useTranslation()
  void t
  const registry = useServiceRegistry()
  const activeMintUrl = useAppStore((s) => s.activeMintUrl)
  const addToast = useAppStore((s) => s.addToast)
  const pendingTransfers = useAppStore((s) => s.pendingTransfers)

  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(activeMintUrl)
  const [mintSheetOpen, setMintSheetOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [transferId, setTransferId] = useState<string | null>(null)
  const [pageStatus, setPageStatus] = useState<PageStatus>('idle')

  const currentTransfer = useMemo(() => {
    if (!transferId) return undefined
    return pendingTransfers.find((t) => t.id === transferId)
  }, [pendingTransfers, transferId])

  const invoice = useMemo(() => {
    const ref = currentTransfer?.transportRef as { request?: string } | undefined
    return ref?.request ?? null
  }, [currentTransfer])

  const displayStatus = useMemo<PageStatus>(() => {
    if (pageStatus === 'error') return 'error'
    if (pageStatus === 'creating') return 'creating'
    if (pageStatus === 'claiming') return 'claiming'
    if (!currentTransfer) return pageStatus
    if (currentTransfer.phase === 'settled') return 'settled'
    if (currentTransfer.phase === 'failed') return 'failed'
    return currentTransfer.phase as PageStatus
  }, [pageStatus, currentTransfer])

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
    setTransferId(null)
    setPageStatus('creating')

    try {
      const transfer = await registry.transferLifecycle.initiateIncomingTransfer(
        {
          txId: crypto.randomUUID(),
          accountId: selectedMintUrl,
          amount: sat(Number(amount)),
          memo: memo.trim() || undefined,
        },
        'bolt11',
      )

      setTransferId(transfer.id)
      setPageStatus('submitted')
      setLastResult(
        `Transfer: ${transfer.id}\nPhase: ${transfer.phase}\nInvoice ready`,
      )
      addToast({ type: 'success', message: 'Invoice created (TLS)' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLastResult(`Error: ${msg}`)
      addToast({ type: 'error', message: msg })
      setPageStatus('error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCheck = async () => {
    if (!transferId) return
    setIsLoading(true)
    try {
      await registry.transferLifecycle.pollPendingTransfers()
      const updated = pendingTransfers.find((t) => t.id === transferId)
      if (updated) {
        setLastResult(`Phase: ${updated.phase}\nID: ${updated.id}`)
        addToast({ type: 'success', message: `Phase: ${updated.phase}` })
      }
    } catch (err) {
      setLastResult(`Check error: ${String(err)}`)
      addToast({ type: 'error', message: String(err) })
    } finally {
      setIsLoading(false)
    }
  }

  const handleClaim = async () => {
    if (!transferId) return
    setIsLoading(true)
    setPageStatus('claiming')
    try {
      await registry.transferLifecycle.claimIncomingTransfer(transferId)
      setLastResult('Claimed successfully!')
      addToast({ type: 'success', message: 'Proofs claimed (TLS)' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLastResult(`Claim error: ${msg}`)
      addToast({ type: 'error', message: msg })
      setPageStatus('awaiting_confirmation')
    } finally {
      setIsLoading(false)
    }
  }

  const copyInvoice = () => {
    if (!invoice) return
    void navigator.clipboard.writeText(invoice)
    addToast({ type: 'success', message: 'Invoice copied' })
  }

  const showClaimButton = currentTransfer ? canComplete(currentTransfer) : false
  const isClaiming = pageStatus === 'claiming'

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
          TLS Bolt11 Receive
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
            <label className="text-caption text-foreground-muted block mb-1">Description</label>
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
            loading={isLoading && pageStatus === 'creating'}
            icon={<CheckCircle className="size-4" />}
            className="w-full mt-2"
          >
            Create Invoice
          </Button>

          {transferId && (
            <Button
              variant="outline"
              size="lg"
              onClick={handleCheck}
              loading={isLoading && !isClaiming}
              icon={<ClipboardCopy className="size-4" />}
              className="w-full"
            >
              Check Status
            </Button>
          )}

          {showClaimButton && (
            <Button
              variant="brand"
              size="lg"
              onClick={handleClaim}
              loading={isClaiming}
              icon={<Zap className="size-4" />}
              className="w-full"
            >
              Claim Proofs
            </Button>
          )}
        </div>

        {/* Invoice display */}
        {invoice && (
          <div className="bg-background-card rounded-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-caption text-foreground-muted">Invoice</p>
              <button
                onClick={copyInvoice}
                className="p-2 rounded-lg bg-background active:opacity-70 transition-opacity"
              >
                <ClipboardCopy className="w-4 h-4" strokeWidth={1.8} />
              </button>
            </div>
            <p className="text-body break-all font-mono text-sm">{invoice}</p>
            <p className="text-label text-foreground-muted uppercase tracking-wider">
              Status: <span className={`font-semibold ${stateColor[displayStatus] ?? 'text-foreground'}`}>{displayStatus}</span>
            </p>
          </div>
        )}

        {/* Result */}
        {lastResult && (
          <div className="bg-background-card rounded-card p-4">
            <p className="text-caption text-foreground-muted mb-1">Result</p>
            <pre className="text-body whitespace-pre-wrap break-all">{lastResult}</pre>
          </div>
        )}
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
