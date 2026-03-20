import { useState, useCallback, useEffect } from 'react'
import { X, Copy, Check, Clock, Zap, ArrowDownLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useFormatSats, useFormatFiat } from '@/utils/format'
import { useMintMetadata } from '@/hooks'
import type { PendingItem } from '@/hooks/usePendingItems'

export interface PendingItemDetailSheetProps {
  isOpen: boolean
  item: PendingItem | null
  onClose: () => void
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

export function PendingItemDetailSheet({ isOpen, item, onClose }: PendingItemDetailSheetProps) {
  const { t, i18n } = useTranslation()
  const formatSats = useFormatSats()
  const toFiat = useFormatFiat()
  const [copiedField, setCopiedField] = useState<string | null>(null)
  const [invoice, setInvoice] = useState<string | null>(null)

  const mintUrls = item ? [item.mintUrl] : []
  const { getDisplayName } = useMintMetadata(mintUrls)

  // Fetch invoice for lightning-request
  useEffect(() => {
    if (!isOpen || !item || item.type !== 'lightning-request') {
      setInvoice(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { getMintQuote } = await import('@/coco/manager')
        const quote = await getMintQuote(item.mintUrl, item.id)
        if (!cancelled && quote?.request) {
          setInvoice(quote.request)
        }
      } catch {
        // Quote may have expired
      }
    })()
    return () => { cancelled = true }
  }, [isOpen, item])

  const handleCopy = useCallback(async (text: string, field: string) => {
    await copyToClipboard(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }, [])

  if (!isOpen || !item) return null

  const locale = i18n.language === 'ko' ? 'ko-KR' : i18n.language === 'ja' ? 'ja-JP' : i18n.language === 'es' ? 'es-ES' : i18n.language === 'id' ? 'id-ID' : 'en-US'

  const title = item.type === 'unclaimed-token'
    ? t('mintDetail.ecashToken')
    : t('mintDetail.lightningRequest')

  const fiatStr = toFiat(item.amount)

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString(locale, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })

  const expiryRemaining = item.expiresAt
    ? (() => {
      const remaining = item.expiresAt! - Date.now()
      if (remaining <= 0) return t('mintDetail.pendingExpired')
      const hours = Math.floor(remaining / (1000 * 60 * 60))
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60))
      return hours > 0
        ? t('mintDetail.expiresIn', { time: `${hours}h ${minutes}m` })
        : t('mintDetail.expiresIn', { time: `${minutes}m` })
    })()
    : null

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center pointer-events-none">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/20 backdrop-blur-sm pointer-events-auto animate-fadeIn"
      />

      {/* Sheet */}
      <div className="bg-[#faf9f6] w-full rounded-t-2xl pointer-events-auto relative z-10 shadow-2xl pb-safe max-h-[80vh] overflow-y-auto animate-slideInUp">
        {/* Header */}
        <div className="sticky top-0 bg-[#faf9f6] z-10 flex items-center justify-between px-4 py-4 border-b border-gray-100">
          <div className="w-9" />
          <h2 className="font-['Outfit'] font-bold text-lg text-[#1d1d1f]">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100"
          >
            <X className="w-4 h-4 text-[#1d1d1f]" />
          </button>
        </div>

        <div className="px-6 py-6 space-y-6">
          {/* Icon + Amount */}
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-[#e6e6e6]">
              {item.type === 'unclaimed-token' ? (
                <ArrowDownLeft size={28} strokeWidth={1.5} className="text-[#5B7A54]" />
              ) : (
                <Zap size={28} strokeWidth={1.5} className="text-[#5B7A54]" />
              )}
            </div>
            <div className="text-center">
              <p className="font-['Outfit'] font-bold text-[28px] text-[#1d1d1f]">
                + {formatSats(item.amount)}
              </p>
              {fiatStr && (
                <p className="font-['Outfit'] font-medium text-[14px] text-[#86868b]">
                  ≈ {fiatStr}
                </p>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="bg-gray-50 rounded-xl overflow-hidden">
            {/* Status */}
            <DetailRow
              label={t('history.pendingStatus')}
              value={
                <span className="flex items-center gap-1 text-[#D4A03D]">
                  <Clock size={14} />
                  {t('history.pending')}
                </span>
              }
            />

            {/* Type */}
            <DetailRow
              label={t('txDetail.type')}
              value={title}
              border
            />

            {/* Mint */}
            <DetailRow
              label={t('txDetail.mint')}
              value={getDisplayName(item.mintUrl)}
              border
            />

            {/* Created */}
            <DetailRow
              label={t('txDetail.time')}
              value={formatDate(item.createdAt)}
              border
            />

            {/* Expiry */}
            {expiryRemaining && (
              <DetailRow
                label={t('mintDetail.pendingExpiry')}
                value={
                  <span className="text-[#e85d3a]">{expiryRemaining}</span>
                }
                border
              />
            )}

            {/* Memo */}
            {item.memo && (
              <DetailRow
                label={t('txDetail.memo')}
                value={item.memo}
                border
              />
            )}
          </div>

          {/* Invoice (for lightning-request) */}
          {item.type === 'lightning-request' && invoice && (
            <div>
              <p className="font-['Outfit'] font-semibold text-sm text-[#1d1d1f] mb-2">
                {t('txDetail.bolt11')}
              </p>
              <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between gap-2">
                <span className="text-xs font-mono text-[#86868b] truncate">
                  {invoice.slice(0, 40)}...
                </span>
                <button
                  onClick={() => handleCopy(invoice, 'invoice')}
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-white border border-gray-200 shrink-0"
                >
                  {copiedField === 'invoice' ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4 text-[#86868b]" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailRow({
  label,
  value,
  border = false,
}: {
  label: string
  value: React.ReactNode
  border?: boolean
}) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 ${border ? 'border-t border-gray-100' : ''}`}>
      <span className="text-sm text-[#86868b]">{label}</span>
      <span className="text-sm text-[#1d1d1f] font-medium text-right">{value}</span>
    </div>
  )
}
