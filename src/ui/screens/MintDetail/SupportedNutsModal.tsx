import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

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
      <div className="bg-[#faf9f6] w-[340px] max-h-[70vh] rounded-2xl pointer-events-auto relative z-10 shadow-2xl animate-slideInUp overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 shrink-0">
          <div className="w-9" />
          <h3 className="font-['Outfit'] font-bold text-lg text-[#1d1d1f]">
            {t('mintDetail.supportedProtocols')}
          </h3>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* NUT List */}
        <div className="px-6 pb-6 overflow-y-auto">
          <div className="bg-white rounded-xl overflow-hidden border border-gray-100">
            {nuts.map((nut, i) => (
              <div
                key={nut}
                className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-gray-50' : ''}`}
              >
                <span className="font-mono text-xs text-[#86868b] w-8 shrink-0">
                  {nut.padStart(2, '0')}
                </span>
                <span className="text-sm text-[#1d1d1f]">
                  {nutNames[nut] || `NUT-${nut.padStart(2, '0')}`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Close button */}
        <div className="px-6 pb-6 shrink-0">
          <button
            onClick={onClose}
            className="w-full bg-[#1d1d1f] text-white py-4 rounded-xl font-['Outfit'] font-semibold text-sm active:scale-[0.98] transition-transform"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
