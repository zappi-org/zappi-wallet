import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ClipboardCopy, CheckCircle, ChevronRight, Zap } from 'lucide-react'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useAppStore } from '@/store'
import { sat } from '@/core/domain/amount'
import { Button } from '@/ui/components/common/Button'
import { MintSelectBottomSheet } from '@/ui/components/payment/MintSelectBottomSheet'

interface TlsBolt11ReceivePageProps {
  onBack: () => void
}

type QuoteState = 'idle' | 'creating' | 'UNPAID' | 'PAID' | 'ISSUED' | 'EXPIRED' | 'UNKNOWN' | 'error' | 'claiming'

const stateColor: Record<string, string> = {
  UNPAID: 'text-accent',
  PAID: 'text-accent-success',
  ISSUED: 'text-accent-success',
  EXPIRED: 'text-accent-danger',
  UNKNOWN: 'text-foreground-muted',
  error: 'text-accent-danger',
}

export function TlsBolt11ReceivePage({ onBack }: TlsBolt11ReceivePageProps) {
  const { t } = useTranslation()
  void t
  const registry = useServiceRegistry()
  const activeMintUrl = useAppStore((s) => s.activeMintUrl)
  const addToast = useAppStore((s) => s.addToast)

  const [selectedMintUrl, setSelectedMintUrl] = useState<string | null>(activeMintUrl)
  const [mintSheetOpen, setMintSheetOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [memo, setMemo] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<string | null>(null)
  const [quoteId, setQuoteId] = useState<string | null>(null)
  const [status, setStatus] = useState<QuoteState>('idle')

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
    setInvoice(null)
    setQuoteId(null)
    setStatus('creating')

    try {
      const result = await registry.payment.receive({
        accountId: selectedMintUrl,
        protocol: 'bolt11',
        amount: sat(Number(amount)),
        description: memo.trim() || undefined,
      })

      if (!result.ok) {
        setLastResult(`Error: ${result.error.message}`)
        addToast({ type: 'error', message: result.error.message })
        setStatus('error')
        return
      }

      const req = result.value
      setInvoice(req.encoded)
      setQuoteId(req.id)
      setStatus('UNPAID')
      setLastResult(`Quote: ${req.id}\nExpires: ${req.expiresAt ? new Date(req.expiresAt).toLocaleString() : 'N/A'}`)
      addToast({ type: 'success', message: 'Invoice created' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setLastResult(`Error: ${msg}`)
      addToast({ type: 'error', message: msg })
      setStatus('error')
    } finally {
      setIsLoading(false)
    }
  }

  const handleCheck = async () => {
    if (!quoteId || !selectedMintUrl) return
    setIsLoading(true)
    try {
      const result = await registry.payment.queryReceiveStatus({ requestId: quoteId, accountId: selectedMintUrl })
      if (!result.ok) {
        setLastResult(`Check error: ${result.error.message}`)
        addToast({ type: 'error', message: result.error.message })
        setIsLoading(false)
        return
      }

      const { state, isAlive } = result.value
      setStatus(state as QuoteState)
      setLastResult(`State: ${state}\nAlive: ${isAlive}`)
      addToast({ type: isAlive ? 'success' : 'warning', message: `Quote ${state}` })
    } catch (err) {
      setLastResult(`Check error: ${String(err)}`)
      addToast({ type: 'error', message: String(err) })
    } finally {
      setIsLoading(false)
    }
  }

  const handleClaim = async () => {
    if (!quoteId || !selectedMintUrl) return
    setIsLoading(true)
    setStatus('claiming')
    try {
      const result = await registry.payment.claimReceiveRequest({ requestId: quoteId, accountId: selectedMintUrl })
      if (!result.ok) {
        setLastResult(`Claim error: ${result.error.message}`)
        addToast({ type: 'error', message: result.error.message })
        setStatus('PAID')
        setIsLoading(false)
        return
      }
      setStatus('ISSUED')
      setLastResult(`Claimed! Amount: ${result.value.amount.value} ${result.value.amount.unit}`)
      addToast({ type: 'success', message: 'Proofs claimed' })
    } catch (err) {
      setLastResult(`Claim error: ${String(err)}`)
      addToast({ type: 'error', message: String(err) })
      setStatus('PAID')
    } finally {
      setIsLoading(false)
    }
  }

  const copyInvoice = () => {
    if (!invoice) return
    void navigator.clipboard.writeText(invoice)
    addToast({ type: 'success', message: 'Invoice copied' })
  }

  const canClaim = status === 'PAID'
  const isClaiming = status === 'claiming'

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
            loading={isLoading && status === 'creating'}
            icon={<CheckCircle className="size-4" />}
            className="w-full mt-2"
          >
            Create Invoice
          </Button>

          {invoice && (
            <Button
              variant="outline"
              size="lg"
              onClick={handleCheck}
              loading={isLoading && status !== 'claiming'}
              icon={<ClipboardCopy className="size-4" />}
              className="w-full"
            >
              Check Status
            </Button>
          )}

          {canClaim && (
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
              Status: <span className={`font-semibold ${stateColor[status] ?? 'text-foreground'}`}>{status}</span>
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
