import { useTranslation } from 'react-i18next'
import { Plus, QrCode } from 'lucide-react'

import { brandStyle } from './styles'

export interface CreateRegisterPairProps {
  onCreate: () => void
  onRegister: () => void
}

export function CreateRegisterPair({ onCreate, onRegister }: CreateRegisterPairProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onCreate}
        className="flex items-center justify-center gap-1 h-[60px] w-[120px] rounded-full text-white text-sm font-semibold"
        style={brandStyle}
      >
        <Plus className="w-[18px] h-[18px]" strokeWidth={2.4} />
        {t('token.create')}
      </button>
      <button
        type="button"
        onClick={onRegister}
        className="flex items-center justify-center gap-1 h-[60px] w-[120px] rounded-full text-white text-sm font-semibold"
        style={brandStyle}
      >
        <QrCode className="w-[18px] h-[18px]" strokeWidth={2.4} />
        {t('token.register')}
      </button>
    </div>
  )
}
