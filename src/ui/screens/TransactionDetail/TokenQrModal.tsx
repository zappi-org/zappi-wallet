import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { X, Copy, Check, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'
import { SegmentControl } from '@/ui/components/common/SegmentControl'

/** One selectable QR payload — a protocol variant of the same request/token. */
export interface TokenQrModalPayload {
  id: string
  label: string
  value: string
  /** Bearer payloads veil until tapped; request URIs default to plain. */
  veil?: boolean
}

interface TokenQrModalProps {
  isOpen: boolean
  token: string
  onClose: () => void
  /** Header title — defaults to the sent-ecash label. */
  title?: string
  /** Bearer payloads veil until tapped; invoices are safe to show plainly. */
  veil?: boolean
  /**
   * Multiple protocol representations of the same payload (e.g. a receive
   * request's unified/cashu/lightning URIs). Renders a SegmentControl above
   * the QR when there are 2+. Omit (or pass fewer than 2) to keep the plain
   * single-`token` view — existing call sites are unaffected.
   */
  payloads?: TokenQrModalPayload[]
}

/** How long the ghost-tap shield stays up after a backdrop dismissal. */
export const BACKDROP_SHIELD_MS = 350

export function TokenQrModal({ isOpen, token, onClose, title, veil = true, payloads }: TokenQrModalProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const items = useMemo<TokenQrModalPayload[]>(
    () => (payloads && payloads.length > 0 ? payloads : [{ id: 'single', label: '', value: token, veil }]),
    [payloads, token, veil],
  )
  const [activeId, setActiveId] = useState(items[0].id)
  const active = items.find((item) => item.id === activeId) ?? items[0]

  // Bearer privacy: whoever scans this QR owns the funds — veil until tapped,
  // same contract as the send-flow receipt. Re-arms on every open: the parent
  // keeps this mounted, so state alone would leave later opens unveiled.
  const [veiled, setVeiled] = useState(active.veil ?? false)
  const [wasOpen, setWasOpen] = useState(isOpen)
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen)
    if (isOpen) {
      setActiveId(items[0].id)
      setVeiled(items[0].veil ?? false)
    }
  }

  const handleSelect = useCallback(
    (id: string) => {
      setActiveId(id)
      setVeiled(items.find((item) => item.id === id)?.veil ?? false)
    },
    [items],
  )

  // Ghost-tap shield: the backdrop sits directly over this screen's own controls
  // (e.g. a back button), so dismissing it exposes them immediately — a fast
  // double-tap or a touch's compatibility click can then land on what's beneath.
  // Absorb any follow-up contact at that spot for a beat after a backdrop close
  // only; the X button has nothing underneath it and must close instantly.
  const [shieldActive, setShieldActive] = useState(false)
  const shieldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (shieldTimerRef.current) clearTimeout(shieldTimerRef.current)
    }
  }, [])

  const handleBackdropClose = useCallback(() => {
    onClose()
    setShieldActive(true)
    if (shieldTimerRef.current) clearTimeout(shieldTimerRef.current)
    shieldTimerRef.current = setTimeout(() => {
      setShieldActive(false)
      shieldTimerRef.current = null
    }, BACKDROP_SHIELD_MS)
  }, [onClose])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(active.value)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = active.value
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [active.value])

  if (!isOpen) {
    // Shield outlives the sheet itself so a ghost tap lands on empty air.
    return shieldActive ? (
      <div aria-hidden data-testid="qr-backdrop-shield" className="fixed inset-0 z-[110] pointer-events-auto" />
    ) : null
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center pointer-events-none">
      <div
        onClick={handleBackdropClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto animate-fadeIn"
      />
      <div className="bg-background w-full max-w-[92vw] rounded-2xl pointer-events-auto relative z-10 shadow-2xl animate-slideInUp overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5">
          <div className="w-9" />
          <h3 className="text-subtitle font-semibold text-foreground">
            {title ?? t('txDetail.sentToken')}
          </h3>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Protocol tabs — only when the caller offers more than one payload */}
        {items.length > 1 && (
          <div className="px-6 pb-2">
            <SegmentControl
              value={activeId}
              onChange={handleSelect}
              options={items.map((item) => ({ value: item.id, label: item.label }))}
            />
          </div>
        )}

        {/* QR Code */}
        <div className="flex justify-center px-8 py-4">
          <button
            type="button"
            onClick={() => setVeiled((v) => !v)}
            aria-label={t('send.tokenCreate.tapToReveal')}
            className="relative overflow-hidden rounded-2xl"
          >
            <div className={`transition-all ${veiled ? 'blur-md opacity-40' : ''}`}>
              <QRCodeDisplay
                value={active.value}
                size={220}
                level="M"
                className="rounded-2xl"
              />
            </div>
            {veiled && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
                <div className="text-3xl" aria-hidden>🙈</div>
                <div className="flex items-center gap-1 text-[10px] text-foreground-muted">
                  <Eye className="h-3 w-3" strokeWidth={1.8} />
                  <span>{t('send.tokenCreate.tapToReveal')}</span>
                </div>
              </div>
            )}
          </button>
        </div>

        {/* Copy button */}
        <div className="px-6 pb-app pt-2">
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 bg-background-card text-foreground border border-border py-3.5 rounded-xl font-semibold text-caption active:scale-[0.98] transition-transform shadow-sm"
          >
            {copied ? (
              <><Check className="w-4 h-4" /> {t('mintDetail.copied')}</>
            ) : (
              <><Copy className="w-4 h-4" /> {t('mintDetail.copy')}</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
