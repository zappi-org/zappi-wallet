import { useState, useCallback } from 'react'
import { X, Copy, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { QRCodeDisplay } from './QRCodeDisplay'
import { Button } from './Button'

interface AddressQrModalProps {
  isOpen: boolean
  title: string
  value: string
  onClose: () => void
}

export function AddressQrModal({ isOpen, title, value, onClose }: AddressQrModalProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = value
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [value])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center pointer-events-none">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto animate-fadeIn"
      />
      <div className="bg-background w-full max-w-[340px] rounded-2xl pointer-events-auto relative z-10 shadow-2xl animate-slideInUp overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5">
          <div className="w-9" />
          <h3 className="text-subtitle font-semibold text-foreground">
            {title}
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
          <QRCodeDisplay value={value} size={200} className="rounded-2xl" />
        </div>

        {/* Address text */}
        <p className="text-center text-caption text-foreground-muted px-8 break-all leading-relaxed">
          {value}
        </p>

        {/* Copy button */}
        <div className="px-6 pb-6 pt-4">
          <Button variant="brand" size="lg" onClick={handleCopy} className="w-full">
            {copied ? (
              <><Check className="w-4 h-4 mr-2" /> {t('common.copied')}</>
            ) : (
              <><Copy className="w-4 h-4 mr-2" /> {t('common.copy')}</>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
