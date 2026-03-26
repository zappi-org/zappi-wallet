import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/ui/components/common/Button'

interface SupportedNutsModalProps {
  isOpen: boolean
  nuts: string[]
  nutNames: Record<string, string>
  onClose: () => void
}

export function SupportedNutsModal({ isOpen, nuts, nutNames, onClose }: SupportedNutsModalProps) {
  const { t } = useTranslation()

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center pointer-events-none">
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto animate-fadeIn"
      />
      <div className="bg-background w-[340px] max-h-[70vh] rounded-2xl pointer-events-auto relative z-10 shadow-2xl animate-slideInUp overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-5 shrink-0">
          <div className="w-9" />
          <h3 className="text-subtitle font-semibold text-foreground">
            {t('mintDetail.supportedProtocols')}
          </h3>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* NUT List */}
        <div className="px-6 pb-6 overflow-y-auto">
          <div className="bg-background-card rounded-xl overflow-hidden border border-border">
            {nuts.map((nut, i) => (
              <div
                key={nut}
                className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? 'border-t border-border' : ''}`}
              >
                <span className="font-mono text-label font-medium text-foreground-muted w-8 shrink-0">
                  {nut.padStart(2, '0')}
                </span>
                <span className="text-caption text-foreground">
                  {nutNames[nut] || `NUT-${nut.padStart(2, '0')}`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Close button */}
        <div className="px-6 pb-6 shrink-0">
          <Button variant="brand" size="lg" onClick={onClose} className="w-full">
            {t('common.close')}
          </Button>
        </div>
      </div>
    </div>
  )
}
