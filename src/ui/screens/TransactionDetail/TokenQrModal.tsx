import { useState, useCallback } from 'react'
import { X, Copy, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'

interface TokenQrModalProps {
  isOpen: boolean
  token: string
  onClose: () => void
}

export function TokenQrModal({ isOpen, token, onClose }: TokenQrModalProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

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
      <div className="bg-[#faf9f6] w-[340px] rounded-2xl pointer-events-auto relative z-10 shadow-2xl animate-slideInUp overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4">
          <div className="w-9" />
          <h3 className="font-['Outfit'] font-bold text-lg text-[#1d1d1f]">
            {t('txDetail.sentToken')}
          </h3>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* QR Code */}
        <div className="flex justify-center px-8 py-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm">
            <QRCodeSVG value={token} size={200} level="L" />
          </div>
        </div>

        {/* Copy button */}
        <div className="px-6 pb-6 pt-2">
          <button
            onClick={handleCopy}
            className="w-full flex items-center justify-center gap-2 bg-white text-[#1d1d1f] border border-black/10 py-4 rounded-xl font-['Outfit'] font-semibold text-sm active:scale-[0.98] transition-transform shadow-sm"
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
