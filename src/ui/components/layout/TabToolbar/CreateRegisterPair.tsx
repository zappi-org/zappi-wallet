import { useTranslation } from 'react-i18next'
import { Plus, QrCode } from 'lucide-react'
import { motion } from 'motion/react'

import { brandStyle } from './styles'

export interface CreateRegisterPairProps {
  onCreate: () => void
  onRegister: () => void
}

export function CreateRegisterPair({ onCreate, onRegister }: CreateRegisterPairProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3">
      <motion.button
        type="button"
        onClick={onCreate}
        whileTap={{ scale: 0.9 }}
        className="flex items-center justify-center gap-1 h-[52px] w-[120px] rounded-full text-white text-sm font-semibold transform-gpu will-change-transform"
        style={brandStyle}
      >
        <Plus className="w-[18px] h-[18px]" strokeWidth={2.4} />
        {t('token.create')}
      </motion.button>
      <motion.button
        type="button"
        onClick={onRegister}
        whileTap={{ scale: 0.9 }}
        className="flex items-center justify-center gap-1 h-[52px] w-[120px] rounded-full text-white text-sm font-semibold transform-gpu will-change-transform"
        style={brandStyle}
      >
        <QrCode className="w-[18px] h-[18px]" strokeWidth={2.4} />
        {t('token.register')}
      </motion.button>
    </div>
  )
}
