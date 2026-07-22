import { useState, useCallback, useEffect } from 'react'
import { X, Copy, Check, Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QRCodeDisplay } from '@/ui/components/common/QRCodeDisplay'

interface TokenQrModalProps {
  isOpen: boolean
  token: string
  onClose: () => void
}

export function TokenQrModal({ isOpen, token, onClose }: TokenQrModalProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  // Bearer privacy: whoever scans this QR owns the funds — veil until tapped,
  // same contract as the send-flow receipt. Re-arms on every close: the parent
  // keeps this mounted, so state alone would leave later opens unveiled.
  const [veiled, setVeiled] = useState(true)
  useEffect(() => {
    if (!isOpen) setVeiled(true)
  }, [isOpen])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(token)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = token
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [token])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center pointer-events-none">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto animate-fadeIn"
      />
      <div className="bg-background w-full max-w-[92vw] rounded-2xl pointer-events-auto relative z-10 shadow-2xl animate-slideInUp overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5">
          <div className="w-9" />
          <h3 className="text-subtitle font-semibold text-foreground">
            {t('txDetail.sentToken')}
          </h3>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

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
                value={token}
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
