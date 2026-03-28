import { useTranslation } from 'react-i18next'
import { QrScanner } from './QrScanner'

interface QrScannerModalProps {
  isOpen: boolean
  onClose: () => void
  onScan: (result: string) => void
}

export function QrScannerModal({ isOpen, onClose, onScan }: QrScannerModalProps) {
  const { t } = useTranslation()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-background rounded-2xl w-full max-w-sm overflow-hidden animate-scaleIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-subtitle font-semibold">{t('scanner.title')}</h2>
          <button
            onClick={onClose}
            className="text-body font-medium text-brand active:opacity-70"
          >
            {t('common.close')}
          </button>
        </div>
        <div className="px-4 pb-5">
          <QrScanner onScan={onScan} active={isOpen} />
        </div>
      </div>
    </div>
  )
}
